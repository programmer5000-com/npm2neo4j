const procString = (str) => {
    let arr = [];
    for(let i = 0; i < num; i++){
        if(num > str.length) break;
        arr.push(str.slice(0, num));
        str = str.slice(num);
    }
    return {arr, str};
};
const undoString = (path) => path.slice(0, -5).replace(/[\/\\]+/gen, "");
