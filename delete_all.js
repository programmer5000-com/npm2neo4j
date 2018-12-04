const neo4j = require("neo4j-driver").v1;
const config = require("./config.json");
const driver = neo4j.driver(config.url, neo4j.auth.basic(config.username, config.password), {disableLosslessIntegers: true});
const session = driver.session();
console.log("deleting all nodes...");
session.run(`MATCH (n)
DETACH DELETE n`).then(() => {
	console.log("Done! Cleaning up...");
	session.close();
	driver.close();
	console.log("Completed");
});
