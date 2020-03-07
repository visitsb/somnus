class App {
    constructor() {
        this._docker = null;
        this._logger = null;
        this._config = null;
    }

    /* Getters and setter */
    get logger() {
        return this._logger;
    }

    set logger(logger) {
        this._logger = logger;
    }

    get docker() {
        return this._docker;
    }

    set docker(docker) {
        this._docker = docker;
    }

    get config() {
        return this._config;
    }

    set config(config) {
        this._config = config;
    }

    /* Methods */
    async init() {
        const args = require('commander');

        args.version('1.0.0', '-v, --version', 'output the current version')
            .option('-c, --config <config.yml>', 'path to somnus.yml config')
            .parse(process.argv);

        if (args.config) {
            const yaml = require('js-yaml'), fs = require('fs');

            try {
                const logger = require("./log.config");
                await logger.init();

                this.logger = logger.logger;
                this.config = yaml.safeLoad(fs.readFileSync(args.config, 'utf8'));

                this.logger.http(`Connecting to docker engine on ${JSON.stringify(this.config.docker.config)}...`);
                const Dockerode = require('dockerode');
                const Docker = require('./docker');

                this.docker = new Docker(this.logger, this.config, new Dockerode(this.config.docker.config));
            } catch (e) {
                throw {help: () => console.error(e.message)};
            }
        } else {
            throw args;
        }
    }

    async start() {
        const _ = require('lodash/fp');
        this.logger.info("Somnus has started");

        const services = await this.docker.listServices();
        await Promise.all(_.map(async (service) => await service.update())(services));

        this.logger.info("Somnus has finished");
    }

    /* Private internal methods */
}

module.exports = new App();
