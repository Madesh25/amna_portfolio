const btoa = (str) => Buffer.from(str, 'binary').toString('base64');
const atob = (b64Encoded) => Buffer.from(b64Encoded, 'base64').toString('binary');
const encodeURIComponent = escape;
const decodeURIComponent = unescape;

const encodeBase64 = (str) => {
    return btoa(encodeURI(str).replace(/%([0-9A-F]{2})/g,
        function toSolidBytes(match, p1) {
            return String.fromCharCode('0x' + p1);
        }));
};

const decodeBase64 = (str) => {
    try {
        return decodeURI(atob(str).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
    } catch (e) {
        return atob(str);
    }
};

let content = JSON.stringify({
    quote: "It always seems impossible until it's done.",
    author: "Nelson Mandela"
}, null, 2);

console.log("Original:", content);
let enc = encodeBase64(content);
console.log("Encoded:", enc);
let dec = decodeBase64(enc);
console.log("Decoded:", dec);

try {
    let parsed = JSON.parse(dec);
    console.log("Parsed successful!", parsed);
} catch (e) {
    console.error("Parse failed!", e);
}
