import fs from "fs";
import jsdom from "jsdom";
import plotly from "plotly.js";

// TODO :: would be nice to actually read this from import.meta but I can't deal with the ts/node modules cluster
const plotlyFilepath = `${__dirname}/../node_modules/plotly.js/dist/plotly.min.js`
// const plotlyFilepath = `${__dirname}/../node_modules/plotly.js/dist/plotly.js`

/*
 * Loads the webpacked/minified plotly frontend JS into a phantom jsdom window in order to render plots headless.
 * TODO :: it would be nice to instantiate this once and then just call into the plotly singleton, but I don't know the
 * reentrancy of that for multiple images generating at once. For now, just build and teardown a new dom for every
 * request
 */
export async function loadPlotly(): Promise<any> {
    // Can't get the newer version of the jsdom @types compiling, so use old version which used to only have sendTo
    // instead of forwardTo, and just cast it to any so we can call it (using the newer actual jsdom package version
    // with forwardTo support)
    const virtual_console: any = new jsdom.VirtualConsole();
    virtual_console.forwardTo(console);
    const jsdomWindow = new jsdom.JSDOM('', {runScripts : 'dangerously', virtualConsole : virtual_console}).window;

    // Stub two functions that plotly calls (but doesn't really need) that aren't provided by jsdom
    jsdomWindow.HTMLCanvasElement.prototype.getContext = () => null;
    jsdomWindow.URL.createObjectURL = () => "";

    const plotlyJsBuffer = await fs.promises.readFile(plotlyFilepath, "utf-8");
    await                        jsdomWindow.eval(plotlyJsBuffer);

    // This can be called just like a normal plotly module
    return jsdomWindow.Plotly;
}
