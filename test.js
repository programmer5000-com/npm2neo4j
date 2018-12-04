const fscache = require("./fscache.js");
(async () => {
	await fscache.init();
	await fscache.writeJSON(process.argv[2] || "helloworld", {hello: "world"});
	console.log(await fscache.readJSON(process.argv[2] || "helloworld"));
})();
