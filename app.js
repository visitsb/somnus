const app = require('./lib');

// Main app flow
(async function () {
    await app.init();
    await app.start();
})().catch(err => err.help ? err.help() : console.error(err));