process.on("warning", e => console.warn(e.stack));

const fetch = require("@zeit/fetch-retry")(require("node-fetch"));
const fetchConfig = {headers: {"User-Agent": "npm2neo4j (+ @programmer5000 here. Sorry if this is doing too many requests. https://github.com/programmer5000-com/npm2neo4j)"}, retry: {retries: 5}};
const chalk = require("chalk");
const fscache = require("./fscache");
const neo4j = require("neo4j-driver");
const fromStandardDate = neo4j.types.DateTime.fromStandardDate;
const config = require("./config.json");
const maxLines = config.max_lines > 0 ? config.max_lines : Infinity;
const timeout = config.timeoutMultiplier || 50;
const bufferSize = config.bufferSize || 1;
const driver = neo4j.driver(config.url, neo4j.auth.basic(config.username, config.password), {disableLosslessIntegers: true});
const session = driver.session();
let done = false;
let closed = false;

// metrics
let numUploaded = 0;
let numErrors = 0;
let lastUploadStart = "";
let lastUploaded = "";

// stats
let downloading = 0;
let waiting = 0;
let uploading = 0;

let packagesBuffer = [];

const properties = [
	"description",
	"homepage",
	"keywords",
	"maintainers",
	"readmeFilename",
	[data => data.license || "none", "license"],
	"name",
	[data => (data.author && data.author.name) ? data.author : ((data.maintainers && data.maintainers.length) ? data.maintainers[0] : {name: -1, email: -1}), "author"],
	[data => data.bugs && data.bugs.url, "bugs"],
	[data => data.license && data.license.type, "license"],
	[data => data.repository && data.repository.url, "repository"],
	[data => data.repository && data.repository.type, "repositoryType"],
	[data => data.users ? Object.keys(data.users) : [], "users"],
	[data => fromStandardDate(new Date(data.time.modified)), "modifiedTime"],
	[data => fromStandardDate(new Date(data.time.created)), "createdTime"]
];

const padTo50 = str => {
	return (str + " ".repeat(Math.max(50 - str.length, 0))).slice(0, 50);
};


(async function (){
	const log = (...stuff) => {
		console.log(...stuff);
	};

	log("starting...");
	let lineBuffer = "";
	const resp = await fetch("https://skimdb.npmjs.com/registry/_all_docs", fetchConfig);
	log("fetched");
	const stream = resp.body;

	let firstLine = false;
	let linesRead = 0;
	const procLine = async line => {
		if(!firstLine) return firstLine = true;
		if(linesRead >= maxLines){
			done = true;
			return;
		}
		linesRead ++;

		if(line[line.length - 1] === ","){
			line = line.slice(0, -1);
			const module = JSON.parse(line);
			const moduleName = module.key;
			await downloadModule(moduleName);
		}
	};

	const downloadModule = async function (moduleName){

		packagesBuffer.push((async () => {

			downloading ++;
			lastUploadStart = moduleName;
			const module = (await fscache.getModule(moduleName)).data;

			const obj = {};

			properties.forEach(property => {
				try {
					const key = typeof property === "string" ? property : (property[1] || property[0]);
					const preValue = typeof property === "string" ? property : property[0];
					const value = typeof preValue === "function" ? preValue(module) : module[preValue];
					if (value) {
						obj[key] = value;
					}
				}catch(e){
					console.log(moduleName, property);
					throw e;
				}
			});

			const mostRecentVersion = module.versions[(module["dist-tags"] && module["dist-tags"].latest) || Object.keys(module.versions).slice(-1)[0]];
			const dependencies = mostRecentVersion && mostRecentVersion.dependencies ? Object.entries(mostRecentVersion.dependencies) : [];
			obj.mostRecentVersion = mostRecentVersion ? mostRecentVersion.version : "";
			obj.dependencies = dependencies.map(([name, version]) => ({
				name,
				version
			}));

			downloading --;
			waiting ++;

			return obj;
		})());

		const procEnd = () => {
			if (done) {
				session.close();
				driver.close();
				showStatus();
				setImmediate(process.exit);
			}
		};

		if(packagesBuffer.length >= bufferSize) {
			const packages = await Promise.all(packagesBuffer);
			waiting -= packagesBuffer.length;
			uploading += packagesBuffer.length;
			const string = `
		FOREACH (package IN $packages | 
			MERGE (a:Package { name: package.name })
			SET a.bugs = package.bugs,
			a.description = package.description,
			a.homepage = package.homepage,
			a.keywords = package.keywords,
			a.name = package.name,
			a.repository = package.repository,
			a.repositoryType = package.repositoryType,
			a.createdTime = package.createdTime,
			a.modifiedTime = package.modifiedTime,
			a.mostRecentVersion = package.mostRecentVersion
						
			FOREACH (dep IN package.dependencies |
				MERGE (p:Package { name : dep.name })
				CREATE (a)-[e:DEPENDS_ON {version: dep.version }]->(p)
			)

			FOREACH (user IN package.users |
				MERGE (u:Person { name : user })
				MERGE (u)-[e:USES]->(a)
			)

			FOREACH (user IN package.maintainers |
				MERGE (u:Person { name : user.name })
				SET u.email = coalesce(user.email, u.email) // set the email to what we have if that is provided, otherwise keep it as-is
				MERGE (u)-[e:MAINTAINS]->(a)
			)

			MERGE (u:Person { name : package.author.name })
			SET u.email = coalesce(package.author.email, u.email) // set the email to what we have if that is provided, otherwise keep it as-is
			MERGE (u)-[e:AUTHORS]->(a)

			MERGE (l:License { name: package.license } )
			MERGE (a)-[:LICENSES]->(l)
		)
		`;

			try {
				await session.run(
					string,
					{packages});
				lastUploaded = moduleName;
				numUploaded += packagesBuffer.length;
				procEnd();
			} catch (e) {
				console.log(packages, moduleName);
				numErrors++;
				console.error(chalk.bgRedBright("\n\n================ COULD NOT UPLOAD, FAILED WITH ERROR: ================\n"), e, chalk.bgRedBright("\nQUERY"), string, chalk.bgRedBright("\nMODULE"));
				procEnd();
			}
			uploading -= packagesBuffer.length;
			packagesBuffer = [];
		}else{
			procEnd();
		}
	};

	let lock = false;

	const procData = async data => {
		if(lock) throw new Error("\n\n\n\nLock failed\n\n\n\n");
		lock = true;
		if(done) return stream.removeListener("data", procData);
		if(!data) return;
		data = data.toString();
		if(!data) return;

		stream.pause();

		data = lineBuffer + data.replace(/\r/g, "");
		data = data.split("\n");

		const lines = data.slice(0, -1);
		for(const line of lines){
			await procLine(line);
		}

		lineBuffer = data.slice(-1)[0];
		stream.resume();
		lock = false;
	};
	stream.on("data", procData);
	stream.on("close", async () => {
		await procLine(lineBuffer);
		closed = true;
		done = true;
	});

	const showStatus = () => {
		let etaMs;
		if(maxLines !== undefined){
			etaMs = (maxLines - numUploaded) * timeout;
		}else if(closed){
			etaMs = (uploading + numUploaded - numUploaded) * timeout;
		}
		const date = new Date;
		if(etaMs) date.setMilliseconds(date.getMilliseconds() + etaMs);

		const eta = etaMs ? date.toString() : "unknown";

		const line = chalk`{bold {gray ${(new Date).toString()}} Errors: {red ${numErrors}}\tUploaded: {green ${numUploaded}/${maxLines}}\tUploading: {cyan ${uploading}}\tWaiting: {yellow ${waiting}}\tDownloading: {green ${downloading}}\tLines read: {magenta ${linesRead}/${maxLines}}\tMost recent upload started: {blue ${padTo50(lastUploadStart)}}\tMost recent successful upload: {yellow ${padTo50(lastUploaded)}}\tETA: ${eta}}`;
		console.error(line);
	};

	setInterval(showStatus, config.statusIntervalMs || 10000);

	const stdin = process.stdin;
	// stdin.resume();
	stdin.setEncoding("utf8");
	stdin.on("data", showStatus);
})();
