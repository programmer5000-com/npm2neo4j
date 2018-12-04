const MAX_LINES = 5;
const fetch = require("node-fetch");
const neo4j = require("neo4j-driver").v1;
const driver = neo4j.driver("bolt://52.23.245.35:34519", neo4j.auth.basic("neo4j", "component-implementation-fence"), {disableLosslessIntegers: true});
const session = driver.session();

const properties = [[data => data.users || (data.maintainers && data.maintainers[0] && data.maintainers[0].name), "author"], ["bugs.url", "bugs"], "description", "homepage", "keywords", "license", "name", ["repository", "repository.url"], ["repositoryType", "repository.type"], [data => data.users && Object.keys(data.users), "users"]];

(async function (){
	console.log("starting...");
	let lineBuffer = "";
	const resp = await fetch("https://skimdb.npmjs.com/registry/_all_docs");
	console.log("fetched");
	const stream = resp.body;

	let firstLine = false;
	let count = 0;
	const procLine = line => {
		if(!firstLine) return firstLine = true;
		count ++;
		if(count > MAX_LINES) return;

		if(line[line.length - 1] === ","){
			line = line.slice(0, -1);
			const module = JSON.parse(line);
			moduleName = module.key;
			console.log(moduleName);
			downloadModule(moduleName).catch(console.error);
		}
	};

	const downloadModule = async function (moduleName){
		console.log(moduleName);
		const resp = await fetch("https://skimdb.npmjs.com/registry/" + encodeURIComponent(moduleName));
		const module = await resp.json();

		const obj = {};

		const propertiesUsed = [];
		properties.forEach(property => {
			const key = typeof property === "string" ? property : (property[1] || property[0]);
			const preValue = typeof property === "string" ? property : property[0];
			const value = typeof preValue === "function" ? preValue(module) : module[preValue];
			if(value){
				obj[key] = value;
				propertiesUsed.push(typeof property === "string" ? property : property[1] || property[0]);
			}
		});

		const setString = propertiesUsed.reduce((acc, prop) => `${acc}a.${prop} = ${prop},` , "").slice(0, -1);

		//module.maintainers.forEach();

		const string = 'CREATE (a:Package) SET ' + setString + ' RETURN a';
		console.log(string, obj);
		const resultPromise = session.run(
		  string,
		  obj);
		resultPromise.then(result => {
			console.log("\n".repeat(100));
		  session.close();
		  const singleRecord = result.records[0];
		  const greeting = singleRecord.get(0);
		  console.log(greeting);
		});
	};

	stream.on("data", data => {
		if(!data) return;
		data = data.toString();
		if(!data) return;

		data = lineBuffer + data.replace(/\r/g, "");
		data = data.split("\n");

		data.slice(0, -1).forEach(procLine);

		lineBuffer = data.slice(-1)[0];
	});
	stream.on("close", () => procLine(lineBuffer));
})();
