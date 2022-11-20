const visit = require('unist-util-visit');
const puppeteer = require('puppeteer');

class HeadlessMermaidError extends Error {
    constructor(message, cause) {
        if(typeof cause === "string") {
            cause = {
                stack: "!!MISSING!!",
                message: cause,
            }
        } else if(!(typeof cause === "object" && "message" in cause)) {
            cause = {
                message: "!!UNPARSEABLE ERROR!! value:",
                stack: JSON.stringify(cause),
            }
        }
        const m = `${message}: ${cause.message}\n${cause.stack}`
        super(m)
        this.name = "HeadlessMermaidError"
        this.cause = cause
    }
}

async function render(page, id, definition) {

    const {success,svgCode,error} = await page.evaluate(async (id, definition) => {
        try {
            const svgCode = await window.mermaid.mermaidAPI.render(id, definition)
            return {
                success: true,
                svgCode,
                error: null
            }
        } catch (e) {
            return {
                success: false,
                svgCode: null,
                error: JSON.stringify(e, Object.getOwnPropertyNames(e))
            }
        }
    }, id, definition);

    if(success){
        return svgCode
    } else {
        throw new HeadlessMermaidError("failed to render SVG", JSON.parse(error))
    }
}

function mermaidNodes(markdownAST, language) {
    const result = []
    visit(markdownAST, 'code', node => {
        if ((node.lang || '').toLowerCase() === language) {
            result.push(node)
        }
    });
    return result;
}

async function getMermaidBrowser(viewport, mermaidOptions) {
    try{
        browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});
        const page = await browser.newPage();
        page.setViewport(viewport);
        await page.goto('data:text/html,<html></html>');

        script = require.resolve('mermaid/dist/mermaid.js')
        console.log('mermaid.min', script)
        console.log("mermaidOptions", mermaidOptions)

        await page.addScriptTag({
            path:  script,
        });
        const {success, error} = await page.evaluate(async (mermaidOptions) => {
    
            try {
                await window.mermaid.initialize(mermaidOptions)

                return {
                    success: true,
                    error: null
                }
            } catch (e) {
                return {
                    success: false,
                    error: JSON.stringify(e, Object.getOwnPropertyNames(e))
                }
            }
        }, mermaidOptions);
        if(success){
            return {browser,page}
        } else {
            throw new HeadlessMermaidError("failed to initialize mermaid", JSON.parse(error))
        }
    } catch(e) {
        if (e instanceof HeadlessMermaidError){
            throw e
        } else {
            throw new HeadlessMermaidError("failed to initialize browser", e)
        }
    }
}

module.exports = async ({markdownAST},
                        {
                            language = 'mermaid',
                            viewport = {height: 200, width: 200},
                            mermaidOptions = {}
                        }) => {
    // Check if there is a match before launching anything
    let nodes = mermaidNodes(markdownAST, language);
    if (nodes.length === 0) {
        // No nodes to process
        return;
    }

    // Launch virtual browser
    const {browser,page} = await getMermaidBrowser(viewport, mermaidOptions)

    console.log("browser created.")
    let count = 0
    try {
        await Promise.all(nodes.map(async node => {
            node.type = 'html';

            const svgCode = await render(page, `mermaid${count}`, node.value);
            node.value = svgCode
        }));
    } finally {
        if (browser) {
            await browser.close();
        }
    }
};
