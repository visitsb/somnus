class App {
    constructor() {
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

    get config() {
        return this._config;
    }

    set config(config) {
        this._config = config;
    }

    /* Methods */
    async start() {
        const _ = require('lodash/fp');
        this.logger.info("Somnus has started");

        let services = await this._listServices();
        services = await Promise.all(_.map(this._checkForLatestVersion.bind(this))(services));

        this.logger.info("Somnus has finished");
    }

    async init() {
        const args = require('commander');

        args.version('1.0.0', '-v, --version', 'output the current version')
            .option('-c, --config <config.yml>', 'path to somnus.yml config')
            .parse(process.argv);

        if (args.config) {
            const yaml = require('js-yaml');
            const fs = require('fs');
            try {
                const logger = require("./log.config");
                await logger.init();
                this.logger = logger.logger;

                const config = yaml.safeLoad(fs.readFileSync(args.config, 'utf8'));
                this.config = config;
            } catch (e) {
                throw {help: () => console.error(e.message)};
            }
        } else {
            throw args;
        }
    }

    /* Private internal methods */
    async _listServices() {
        const _ = require('lodash/fp');
        const Docker = require('dockerode');
        this.logger.debug(`Connecting to docker engine on ${JSON.stringify(this.config.docker.config)}...`);
        const docker = new Docker(this.config.docker.config);

        var servicesList = await docker.listServices();
        this.logger.verbose(`Got '${servicesList.length}' docker services...`);

        const jq = require('node-jq');
        const parse = require('docker-parse-image');

        let services = await jq.run('.[] | { name: .Spec.Name, stack: .Spec.Labels."com.docker.stack.namespace", image: .Spec.Labels."com.docker.stack.image", digest: .Spec.TaskTemplate.ContainerSpec.Image }', JSON.stringify(servicesList),
            {input: 'string', output: 'json', slurp: false});
        services = await jq.run('.', services, {input: 'string', output: 'json', slurp: true}); // Slurp up the results into an array
        services = await Promise.all(_.map(async (service) => {
            let image = parse(_.path('image')(service));
            image = _.pickBy(_.identity)(image); // Squash any undefined, null values
            image = _.defaults({...this.config.docker.defaults, repository: ''})(image);
            this.logger.silly(`Parsed image: '${image.name}' as '${JSON.stringify(image)}'`);

            // mysql:5.7.28@sha256:b38555e593300df225daea22aeb104eed79fc80d2f064fde1e16e1804d00d0fc
            service = _.set('digest')(_.split('@')(service.digest)[1])(service);
            // Overwrite the `image` tag with parsed info
            service = _.set('image')(image)(service);

            return service;
        })(services));

        return services;
    }

    async _checkForLatestVersion(service) {
        const _ = require('lodash/fp');
        const axios = require('axios').default;
        const jq = require('node-jq');

        const {name, repository, version, registry, namespace} = service.image;
        const url = `https://${registry}/${version}/repositories/${namespace}/${repository}/tags/`;

        this.logger.debug(`Checking if newer version for image: '${service.image.name}' exists...`);
        this.logger.http(`Fetching all tags from '${url}' image: '${service.image.name}'...`);
        const {data: tags} = await axios.get(url, {params: {page_size: 50, page: 1}});

        // Pick the section containing the `latest` tag
        const latest = await jq.run('.results[] | select(.name=="latest")', tags, {
            input: 'json', output: 'json', slurp: false
        });

        this.logger.verbose(`Analyzing 'latest' tag for image: '${service.image.name}'...`);
        // Get the sha hash of the image that matches the size of the image same as `latest`; no other suitable way was there
        const digest = await jq.run(`.images[] | select(.size==${_.get('full_size')(latest)}) | .digest`, latest, {
            input: 'json', output: 'json', slurp: false
        });

        this.logger.verbose(`Using sha digest '${digest}' available on 'latest' tag for image: '${service.image.name}' to fetch other latest tags...`);
        // Pick all sections that contain an image with sha hash same to `latest` tagged image
        let latestTags = await jq.run(`.results[] | select(.images[].digest=="${digest}")`, tags, {
            input: 'json', output: 'json', slurp: false
        });

        // Create an array from the results
        latestTags = await jq.run(`.`, latestTags, {input: 'string', output: 'json', slurp: true});

        this.logger.verbose(`Gathering all latest tags for image: '${service.image.name}'...`);
        // Sometimes tags can be overlapping e.g. nginx fetches 2 tags 1.17.8; could be from the digest on a different arch
        const uniqTags = _.sortedUniq(_.map((latestTag) => latestTag.name)(latestTags));

        service = _.set('latest.latest')(latest)(service);
        service = _.set('latest.digest')(digest)(service);
        service = _.set('latest.tags')(uniqTags)(service);

        this.logger.verbose(`Latest tags for image: '${service.image.name}' are '${_.join(', ')(service.latest.tags)}'`);
        this.logger.verbose(`Current digest for image: '${service.image.name}' is '${service.digest}'`);
        this.logger.verbose(`Latest digest for image: '${service.image.name}' is '${service.latest.digest}'`);
        return service;
    }

    async findLatestVersion(service) {
        const semver = require('semver');
    }
}

module.exports = new App();
