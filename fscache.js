const path = require("path");
const fs = require("fs");
const util = require("util");
const mkdirPromise = util.promisify(fs.mkdir);
const statsPromise = util.promisify(fs.stat);

const num = 2;
const procString = (str) => {
	let arr = [];
	for(let i = 0; i < num; i++){
		if(num > str.length) break;
		arr.push(str.slice(0, num));
		str = str.slice(num);
	}
	return {arr, str};
};
const undoString = (path) => path.slice(0, -5).replace(/[\/\\]+/g, "");

const eexist = e => e.code === "EEXIST" ? Promise.resolve() : Promise.reject(e);

const getFile = async file => {
	const {arr, str} = procString(file);
	let filePath = "";
	for(let i = 0; i < arr.length ; i ++){
		console.log(arr[i], path.sep);
		const folder = filePath + arr[i] + path.sep;
		await mkdirPromise(folder).catch(eexist);
		filePath += folder;
	}

	console.log(filePath + str);
};

exports.getFile = getFile;
