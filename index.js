process.on('warning', e => console.warn(e.stack));

const fetch = require("node-fetch");
const chalk = require("chalk");
const neo4j = require("neo4j-driver").v1;
const config = require("./config.json");
const MAX_LINES = config.max_lines > 0 ? config.max_lines : Infinity;
const driver = neo4j.driver(config.url, neo4j.auth.basic(config.username, config.password), {disableLosslessIntegers: true});
const session = driver.session();
let numOpen = 0;
let done = false;

// metrics
let numUploaded = 0;
let numErrors = 0;
let lastUploadStart = "";
let lastUploaded = "";


const properties = [
	[data => data.users || (data.maintainers && data.maintainers[0] && data.maintainers[0].name), "author"],
	[data => data.bugs && data.bugs.url, "bugs"],
	"description",
	"homepage",
	"keywords",
	"license",
	"name",
	[data => data.repository && data.repository.url, "repository"],
	[data => data.repository && data.repository.type, "repositoryType"],
	[data => data.users && Object.keys(data.users), "users"]
];

(async function (){
	let backlog = [];
	const log = (...stuff) => {
		console.log(...stuff);
	};

	log("starting...");
	let lineBuffer = "";
	const resp = await fetch("https://skimdb.npmjs.com/registry/_all_docs");
	log("fetched");
	const stream = resp.body;

	let firstLine = false;
	let linesRead = 0;
	const procLine = line => {
		if(!firstLine) return firstLine = true;
		linesRead ++;
		if(linesRead > MAX_LINES){
			done = true;
			return;
		}

		if(line[line.length - 1] === ","){
			numOpen ++;
			line = line.slice(0, -1);
			const module = JSON.parse(line);
			moduleName = module.key;
			downloadModule(moduleName).catch(console.error);
		}
	};

	const downloadModule = async function (moduleName){
		log("processing module", moduleName);
		lastUploadStart = moduleName;
		const resp = await fetch("https://skimdb.npmjs.com/registry/" + encodeURIComponent(moduleName));
		const module = await resp.json();

		const obj = {};

		const propertiesUsed = [];
		properties.forEach(property => {
			const key = typeof property === "string" ? property : (property[1] || property[0]);
			const preValue = typeof property === "string" ? property : property[0];
			const value = typeof preValue === "function" ? preValue(module) : module[preValue];
			if(value && (!value instanceof Array || value.length)){
				obj[key] = value;
				propertiesUsed.push(typeof property === "string" ? property : property[1] || property[0]);
			}
		});

		const setString = propertiesUsed.reduce((acc, prop) => `${acc}a.${prop} = $${prop},` , "").slice(0, -1);

		const mostRecentVersion = module.versions[(module["dist-tags"] && module["dist-tags"].latest) || Object.keys(module.versions).slice(-1)[0]];
		const dependencies = mostRecentVersion.dependencies ? Object.entries(mostRecentVersion.dependencies) : [];
		obj.dependencies = dependencies;

		//module.maintainers.forEach();

		const string = `MERGE (a:Package { name: $name }) SET ${setString}
FOREACH (r IN $dependencies |
	MERGE (a)-[:DEPENDS_ON {version: r[1]}]->(:Package { name : r[0] })
)
RETURN a`;
		const resultPromise = session.run(
		  string,
		  obj);
		Promise.race([resultPromise, new Promise((_, reject) => setTimeout(() => reject("timeout"), 15000))]).then(result => {
		  const singleRecord = result.records[0];
		  const node = singleRecord.get(0);
		  log("Uploaded package", moduleName);
			lastUploaded = moduleName;
			numUploaded ++;
			procEnd();
		}).catch(e => {
			numErrors ++;
			console.error(chalk.bgRedBright("\n\n================ COULD NOT UPLOAD, FAILED WITH ERROR: ================\n"), e, chalk.bgRedBright("\nQUERY"), string, chalk.bgRedBright("\nMODULE"), obj);
			procEnd();
		});

		const procEnd = () => {
			if(numOpen === 1 && done){
				console.log("done!");
				session.close();
				driver.close();
				showStatus();
				setImmediate(process.exit);
			}
			else numOpen --;
		};
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
	stream.on("close", () => {
		procLine(lineBuffer);
		done = true;
	});

	const showStatus = () => {
		const line = chalk`{bold {gray ${(new Date).toString()}}\tErrors: {red ${numErrors}}\tUploaded: {green ${numUploaded}}\tUploading: {cyan ${numOpen}}\tLines read: {magenta ${linesRead}}\tMost recent upload started: {blue ${lastUploadStart}}\tMost recent successful upload: {yellow ${lastUploaded}}}`;
		console.error(line);
	};

	setInterval(showStatus, config.statusIntervalMs || 10000);

	const stdin = process.stdin;
	// stdin.resume();
	stdin.setEncoding("utf8");
	stdin.on("data", showStatus);
})();
