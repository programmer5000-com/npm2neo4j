const path = require("path");
const fs = require("fs");
const util = require("util");
const mkdirPromise = util.promisify(fs.mkdir);
const writeFilePromise = util.promisify(fs.writeFile);

const numSubfolders = 2;
const fileExtension = ".json";
const prefix = "cache";
const procString = (str) => {
	let arr = [];
	for(let i = 0; i < numSubfolders; i++){
		if(numSubfolders > str.length) break;
		arr.push(str.slice(0, numSubfolders));
		str = str.slice(numSubfolders);
	}
	return {arr, str};
};
const undoString = (path) => path.slice(0, -5).replace(/[/\\]+/g, "");

const eexist = e => e.code === "EEXIST" ? Promise.resolve() : Promise.reject(e);
const init = async () => {
	await mkdirPromise(prefix).catch(eexist);
};
exports.init = init;

const getFileLocation = async file => {
	const {arr, str} = procString(file);
	let filePath = "";
	for(let i = 0; i < arr.length ; i ++){
		console.log(arr[i], path.sep);
		const folder = filePath + arr[i] + path.sep;
		await mkdirPromise(folder).catch(eexist);
		filePath = folder;
	}
	filePath += str + fileExtension;
	filePath = path.join(prefix, filePath);
	console.log("filepath", filePath, "str", str, "arr", arr);
};
exports.getFileLocation = getFileLocation;

const readJSON = async file => {
	const location = await getFileLocation(file);
	return require(location);
};

const writeJSON = async (file, json) => {
	if(typeof json !== "string") json = JSON.stringify(json);
	const location = await getFileLocation(file);
	return writeFilePromise(location, json);
};
