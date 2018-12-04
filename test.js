const fscache = require("./fscache.js");
fscache.init().then(() => fscache.getFileLocation(process.argv[2] || "helloworld"));
