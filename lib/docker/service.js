class Service {
    constructor(logger, config, service, spec) {
        this._logger = logger;
        this._config = config;
        this._service = service;
        this._spec = spec;
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

    get service() {
        return this._service;
    }

    set service(service) {
        this._service = service;
    }

    get spec() {
        return this._spec;
    }

    set spec(spec) {
        this._spec = spec;
    }

    /* Methods */
    async update(dryRun = false) {
        const _ = require('lodash/fp');

        let spec = await this._updateSpec(this.spec);
        this.logger.verbose(`Fetching service instance for service '${spec.name}'(=${spec.id})...`);
        const serviceDetails = await this.service.inspect();

        if (_.eq(spec.image.digest)(spec.latest.digest)) {
            this.logger.warn(`Current tag '${spec.image.tag}' is already up to date for service='${spec.name}', image='${spec.image.name}'. Will not update.`);
            return serviceDetails;
        }

        // Docker service can be in process of updating still
        if (_.eq('updating')(_.getOr('completed')('UpdateStatus.State')(serviceDetails))) {
            this.logger.warn(`Service='${spec.name}', id='${spec.id}', stack='${spec.stack}' is currently being updated. Will not update this time.`);
            return serviceDetails;
        }

        this.logger.debug(`Updating service='${spec.name}', id='${spec.id}', stack='${spec.stack}', image='${spec.image.name}@${spec.image.digest}' to latest='${spec.latest.tag}@${spec.latest.digest}'`);
        // https://docs.docker.com/engine/api/v1.37/#operation/ServiceUpdate
        // version - Required
        const opts = _.merge(_.pick(['Name', 'Mode', 'Labels', 'TaskTemplate', 'UpdateConfig', 'RollbackConfig', 'EndpointSpec'])(serviceDetails.Spec))({
            "version": serviceDetails.Version.Index, // https://github.com/apocas/dockerode/blob/master/test/swarm.js#L303
            "Labels": {
                "com.docker.stack.image": spec.latest.tag,
                "com.docker.stack.namespace": spec.namespace
            },
            "TaskTemplate": {"ContainerSpec": {"Image": `${spec.latest.tag}@${spec.latest.digest}`}}
        });

        if (dryRun) {
            this.logger.warn(`Dry-run will update service='${spec.name}', id='${spec.id}', stack='${spec.stack}', image='${spec.image.name}@${spec.image.digest}' to latest='${spec.latest.tag}@${spec.latest.digest}'`);
            return serviceDetails;
        }

        // Once a service is updated it may take some time to see the changes so we check for updates till it succeeds
        let times = 1;
        const delayStretchFactor = 2, delayUnit = 1000 /* ms */,
            sleep = interval => new Promise(resolve => _.delay(interval)(resolve)),
            completeUpdate = async (service) => {
                const result = await service.inspect();
                const status = _.getOr('completed')('UpdateStatus.State')(result);

                this.logger.silly(`Checking if service='${spec.name}', id='${spec.id}', stack='${spec.stack}', image='${spec.image.name}@${spec.image.digest}' is updated to latest='${result.Spec.TaskTemplate.ContainerSpec.Image}'...`);
                if (_.eq('completed')(status)) return true;

                const interval = _.multiply(delayUnit)(_.ceil(_.divide(times += 1)(delayStretchFactor)));
                this.logger.silly(`Update still in progress with status '${status}' for service='${spec.name}', id='${spec.id}', stack='${spec.stack}', image='${spec.image.name}@${spec.image.digest}' is updated to latest='${result.Spec.TaskTemplate.ContainerSpec.Image}'. Checking again in ${_.divide(interval)(delayUnit)}s...`);
                await sleep(interval);
                return await completeUpdate(service);
            };

        await this.service.update(opts);
        await completeUpdate(this.service);

        const result = await this.service.inspect(), status = _.getOr('completed')('UpdateStatus.State')(result);
        this.logger.verbose(`Update completed with status '${status}' for service='${spec.name}', id='${spec.id}', stack='${spec.stack}', image='${spec.image.name}@${spec.image.digest}' is updated to latest='${result.Spec.TaskTemplate.ContainerSpec.Image}'`);
        this.logger.info(`Successfully updated service='${spec.name}', id='${spec.id}', stack='${spec.stack}', image='${spec.image.name}@${spec.image.digest}' to latest='${result.Spec.TaskTemplate.ContainerSpec.Image}'`);
        return result;
    }

    /* Private internal methods */
    async _updateSpec(spec) {
        const _ = require('lodash/fp'), axios = require('axios').default, jq = require('node-jq'),
            leven = require('leven'), {name, repository, version, registry, namespace} = spec.image,
            url = `https://${registry}/${version}/repositories/${namespace}/${repository}/tags/`,
            jqshim = {
                // In-place jq shim to work with quirks figuring out whether input is `string` or `json`
                // Note: Using the shim selectively instead of everywhere
                runsj: async (command, input, opts) => {    // Try with input as `string` first then fail to `json`
                    try {
                        return await jq.run(command, input, _.defaults(opts)({input: 'string'}));
                    } catch (e) {
                        return await jq.run(command, input, _.defaults(opts)({input: 'json'}));
                    }
                },
                runjs: async (command, input, opts) => {    // Try with input as `json` first then fail to `string`
                    try {
                        return await jq.run(command, input, _.defaults(opts)({input: 'json'}));
                    } catch (e) {
                        return await jq.run(command, input, _.defaults(opts)({input: 'string'}));
                    }
                }
            };

        this.logger.debug(`Checking if newer version for image='${spec.image.name}' exists...`);
        this.logger.http(`Fetching all tags from '${url}' image='${spec.image.name}'...`);
        const {data: tags} = await axios.get(url, {params: {page_size: 100, page: 1}});

        // Pick the section containing the `latest` tag
        let latestTag = spec.image.latest;
        const latest = await jq.run(`.results[] | select(.name=="${latestTag}")`, tags, {
            input: 'json', output: 'json', slurp: false
        });

        this.logger.verbose(`Analyzing '${latestTag}' tag for image='${spec.image.name}'...`);
        // Use the architecture and os to determine valid `latest` image digest
        let digest = await jq.run(`.images[] | select(.architecture=="${spec.image.architecture}" and .os=="${spec.image.os}") | .digest`, latest, {
            input: 'json', output: 'json', slurp: false
        });

        this.logger.verbose(`Using sha digest '${digest}' available on '${latestTag}' tag for image='${spec.image.name}' to fetch other related tags...`);
        // Pick all sections that contain an image with sha hash same to `latest` tagged image
        let latestTags = await jq.run(`.results[] | select(.images[].digest=="${digest}")`, tags, {
            input: 'json', output: 'json', slurp: false
        });

        // Note: `somnus` tags failed at next statement; unsure why but inplace shim works
        latestTags = await jqshim.runsj(`.`, latestTags, {input: 'string', output: 'json', slurp: true});

        this.logger.verbose(`Gathering all '${latestTag}' tags for image='${spec.image.name}'...`);
        // Sometimes tags can be overlapping e.g. nginx fetches 2 tags 1.17.8; could be from the digest on a different arch
        const uniqTags = _.sortedUniq(_.map((latestTag) => latestTag.name)(latestTags));

        // Note: If `latestTag` is a number, then an array gets created instead of a key. Therefore, using plain JSON setters.
        // spec = _.set(`latest.${latestTag}`)(latest)(spec);
        spec = _.set(`latest`)({})(spec);
        spec.latest[latestTag] = latest

        spec = _.set('latest.digest')(digest)(spec);
        spec = _.set('latest.tags')(uniqTags)(spec);

        this.logger.verbose(`'${latestTag}' tags for image='${spec.image.name}' are '${_.join(', ')(spec.latest.tags)}'`);

        this.logger.silly(`'Determining the latest suitable tag for image='${spec.image.name}'(='${spec.image.tag} from '${_.join(', ')(spec.latest.tags)}'`);
        if (_.eq(spec.image.digest)(spec.latest.digest)) {  // Already on latest version?
            latestTag = spec.image.tag;
            this.logger.verbose(`Current tag '${spec.image.tag}' is already up to date for image='${spec.image.name}'.`);
        } else {
            latestTag = _.head(_.sortBy((tag) => leven(tag, spec.image.tag))(spec.latest.tags));
            this.logger.verbose(`Latest tag for image='${spec.image.name}' is '${latestTag}' (>='${spec.image.tag}')`);
        }

        let latestSpecTag = `${spec.image.repository}:${latestTag}`;
        if (!_.eq(this.config.docker.defaults.namespace)(spec.image.namespace)) {
            latestSpecTag = `${spec.image.namespace}/${latestSpecTag}`;
        }

        spec = _.set('latest.tag')(latestSpecTag)(spec);
        return spec;
    }
}

module.exports = Service;
