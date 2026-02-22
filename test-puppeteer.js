const puppeteer = require('puppeteer');
(async () => {
    try {
        const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        
        await page.goto("http://localhost:8000/quotes.html");
        await page.evaluate(() => {
            let mockDb = {};
            let contentStr = JSON.stringify({
                quote: "It always seems impossible until it's done.",
                author: "Nelson Mandela"
            });
            mockDb["content/quotes/nelson-mandela.json"] = btoa(encodeURIComponent(contentStr).replace(/%([0-9A-F]{2})/g,
                function toSolidBytes(match, p1) {
                    return String.fromCharCode('0x' + p1);
                }));
            localStorage.setItem("mock_github_db", JSON.stringify(mockDb));
        });

        page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
        page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));
        page.on('requestfailed', request => console.log('BROWSER REQ FAILED:', request.url(), request.failure()?.errorText));

        await page.reload({waitUntil: 'networkidle0'});
        
        const rendered = await page.evaluate(() => document.body.innerHTML);
        if (rendered.includes("Nelson Mandela")) {
            console.log("SUCCESS: Quote rendered!");
        } else {
            console.log("FAILURE: Quote did not render.");
        }

        await browser.close();
    } catch (e) {
        console.error("SCRIPT ERROR", e);
    }
})();
