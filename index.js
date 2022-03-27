const visit = require('unist-util-visit');
const puppeteer = require('puppeteer');

class HeadlessMermaidError extends Error {
    constructor(message, cause) {
        const m = `${message}: ${cause.message}\n${cause.stack}`
        super(m)
        this.name = "HeadlessMermaidError"
        this.cause = cause
    }
}

async function render(page, id, definition) {
    const { success, svgCode, error } = await page.evaluate((id, definition) => {
        try {
            function createElementFromString(htmlString) {
                var div = document.createElement('div');
                div.innerHTML = htmlString.trim();
                return div.firstChild;
            }

            const svgCode = window.mermaid.mermaidAPI.render(id, definition)

            const elem = createElementFromString(svgCode)
            elem.removeAttribute("height")
            elem.removeAttribute("style")
            elem.removeAttribute("width")
            elem.classList.add("mermaid")
            return {
                success: true,
                svgCode: elem.outerHTML,
                error: null
            };
        } catch (e) {
            return {
                success: false,
                svgCode: null,
                error: JSON.stringify(e, Object.getOwnPropertyNames(e))
            }
        }
    }, id, definition);

    if (success) {
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
    try {
        browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        page.setViewport(viewport);
        await page.goto('data:text/html,<html></html>');
        await page.addScriptTag({
            path: require.resolve('mermaid/dist/mermaid.min.js')
        });
        const { success, error } = await page.evaluate((mermaidOptions) => {

            try {
                window.mermaid.initialize(mermaidOptions)

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
        if (success) {
            return { browser, page }
        } else {
            throw new HeadlessMermaidError("failed to initialize mermaid", JSON.parse(error))
        }
    } catch (e) {
        if (e instanceof HeadlessMermaidError) {
            throw e
        } else {
            throw new HeadlessMermaidError("failed to initialize browser", e)
        }
    }
}

const defaultOptions = {
    language: 'mermaid',
    viewport: { height: 200, width: 200 },
    mermaidOptions: {
        theme: 'default',

    }
}

const renderGraphs = async(definitions, options) => {
    const { viewport, mermaidOptions } = {
        ...defaultOptions,
        ...options
    }
    // Launch virtual browser
    const { browser, page } = await getMermaidBrowser(viewport, mermaidOptions)

    console.log("browser created.")
    let count = 0
    try {
        graphs = await Promise.all(definitions.map(async def => {
            const svgCode = await render(page, `mermaid${count}`, def);
            return svgCode
        }));
        return graphs
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

const processRemark = async({ markdownAST }, options) => {

    const { language, viewport, mermaidOptions } = {
        ...defaultOptions,
        ...options
    }

    // Check if there is a match before launching anything
    let nodes = mermaidNodes(markdownAST, language);
    if (nodes.length === 0) {
        // No nodes to process
        return;
    }

    // Launch virtual browser
    const { browser, page } = await getMermaidBrowser(viewport, mermaidOptions)

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

module.exports = processRemark

module.exports.renderGraphs = renderGraphs