class App {
    constructor() {
        this._docker = null;
        this._logger = null;
        this._config = {};
        this._isDryRun = false;
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

    get isDryRun() {
        return this._isDryRun;
    }

    set isDryRun(isDryRun) {
        this._isDryRun = isDryRun;
    }

    /* Methods */
    async init() {
        const _ = require('lodash/fp');
        const args = require('commander');

        args.version('1.0.0', '-v, --version', 'output the current version')
            .option('-c, --config <config.yml>', 'path to somnus.yml config')
            .option('-d, --dry-run', 'if specified, just do a dry run but do not actually update anything')
            .parse(process.argv);

        if (args.config) {
            const yaml = require('js-yaml'), fs = require('fs');

            try {
                this.isDryRun = _.defaultTo(false)(_.get('dryRun')(args));
                this.config = yaml.safeLoad(fs.readFileSync(args.config, 'utf8'));

                const logger = require("./log.config");
                await logger.init(this.config.docker.autoupdate.log.level);
                this.logger = logger.logger;

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
        const _self = this;

        // Schedule the next updates on a regular schedule
        const CronJob = require('cron').CronJob;
        const job = new CronJob({
            cronTime: this.config.docker.autoupdate.schedule,
            onTick: function () {
                const _job = this;
                _self.updateServices().then(() => {
                    _self.logger.info(`Next auto update scheduled for ${_job.nextDates().toISOString()} (${_job.nextDates().fromNow()})`);
                });
            },
            runOnInit: true // Do first update right away
        });

        // All set - start!
        job.start();
    }

    async updateServices() {
        const _ = require('lodash/fp');
        const chain = thenable => async next => await thenable.then(next);

        this.logger.info("Somnus has started");

        const services = await this.docker.listServices();
        let stacks = _.sortBy('spec.order')(services);  // Sort first
        stacks = _.groupBy('spec.stack')(services); // Group by stack next; sort is honored
        stacks = _.mapValues(stack => _.groupBy('spec.order')(stack))(stacks); // Group within each stack per order; sort is honored

        await Promise.all(_.map(async (stack) => {  // Process `stack` is parallel
            let sequence = Promise.resolve();

            await Promise.all(_.map(async (order) => {  // Each `order` one after the other; each `service` within that order in parallel
                sequence = chain(sequence)(await Promise.all(_.map(async (service) => {
                    try {
                        await service.update(this.isDryRun);
                    } catch (e) {
                        this.logger.error(_.defaultTo(e.message)(e));
                        this.logger.error(`Service='${spec.name}', id='${spec.id}', stack='${spec.stack}' could not be updated. Will try updating next time.`);
                    } finally {
                        return service;
                    }
                })(order)));
                return order;
            })(stack));

            return sequence;
        })(stacks));

        if (this.isDryRun) {
            this.logger.warn(`Dry-run will not prune any unused containers and images. Skipping...`);
        } else {
            // Keep the state clean of `stopped` containers, unused images that may have been left after updating the service
            this.logger.verbose(`Pruning unused containers and images...`);
            await this.docker.pruneUnusedContainers();
            await this.docker.pruneUnusedImages();
        }

        this.logger.info("Somnus has finished");
    }

    /* Private internal methods */
}

module.exports = new App();
