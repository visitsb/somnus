class Docker {
    constructor(logger, config, docker) {
        this._logger = logger;
        this._config = config;
        this._docker = docker;
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

    get docker() {
        return this._docker;
    }

    set docker(docker) {
        this._docker = docker;
    }

    /* Methods */
    async listServices() {
        const _ = require('lodash/fp');

        this.logger.verbose(`Fetching all services...`);
        const serviceSpecs = await this._listServices();
        const services = await Promise.all(_.map(this.getService.bind(this))(serviceSpecs));
        return services;
    }

    async pruneUnusedContainers() {
        this.logger.verbose(`Pruning all stopped containers...`);
        await this.docker.pruneContainers();
        this.logger.info(`Successfully pruned all stopped containers`);
    }

    async pruneUnusedImages() {
        this.logger.verbose(`Pruning all unused images...`);
        await this.docker.pruneImages({dangling: false/* When set to false (or 0), all unused images are pruned */});
        this.logger.info(`Successfully pruned all unused images`);
    }

    async getService(serviceSpec) {
        this.logger.verbose(`Fetching service instance for service id '${serviceSpec.name}'(=${serviceSpec.id})...`);
        const service = await this.docker.getService(serviceSpec.id);

        const Service = require('./service');
        return new Service(this.logger, this.config, service, serviceSpec);
    }

    /* Private internal methods */
    async _listServices() {
        const _ = require('lodash/fp'), jq = require('node-jq'), parse = require('docker-parse-image');

        var servicesList = await this.docker.listServices();
        this.logger.verbose(`Got '${servicesList.length}' docker services...`);

        // Dummy service entry to allow jq to work otherwise it complains about JSON object not being a JSON string ... wierd.
        // This dummy entry is removed right after the jq parsing is done.
        servicesList.push(_.set('Spec.TaskTemplate.ContainerSpec.Labels.["somnus.defaults.enable"]')(false)({}));
        let serviceSpecs = await jq.run('.[] | { id: .ID, name: .Spec.Name, stack: .Spec.Labels."com.docker.stack.namespace", enable: .Spec.TaskTemplate.ContainerSpec.Labels."somnus.defaults.enable", order: .Spec.TaskTemplate.ContainerSpec.Labels."somnus.defaults.order", image: { name: .Spec.Labels."com.docker.stack.image", digest: .Spec.TaskTemplate.ContainerSpec.Image, version: .Spec.TaskTemplate.ContainerSpec.Labels."somnus.defaults.version", namespace: .Spec.TaskTemplate.ContainerSpec.Labels."somnus.defaults.namespace", architecture: .Spec.TaskTemplate.ContainerSpec.Labels."somnus.defaults.architecture", os: .Spec.TaskTemplate.ContainerSpec.Labels."somnus.defaults.os", latest: .Spec.TaskTemplate.ContainerSpec.Labels."somnus.defaults.latest.tag" }}', JSON.stringify(servicesList),
            {input: 'string', output: 'json', slurp: false});
        servicesList.pop(); // Remove the dummy service entry

        serviceSpecs = await jq.run('.', serviceSpecs, {input: 'string', output: 'json', slurp: true}); // Slurp up the results into an array

        // Defaults
        serviceSpecs = await Promise.all(_.map(async (serviceSpec) => {
            serviceSpec.enable = _.eq('true')(_.defaultTo('true')(_.get('enable')(serviceSpec)));   // Always `enable=true`
            serviceSpec.order = _.defaultTo(0)(_.get('order')(serviceSpec));    // `order=0`
            return serviceSpec;
        })(serviceSpecs));

        serviceSpecs = _.filter((serviceSpec) => serviceSpec.enable)(serviceSpecs);
        this.logger.info(`Got '${serviceSpecs.length}/${servicesList.length}' enabled docker services...`);

        serviceSpecs = await Promise.all(_.map(async (serviceSpec) => {
            let image = parse(serviceSpec.image.name);
            image = _.pickBy(_.identity)(image); // Squash any undefined, null values
            image = _.defaults({...this.config.docker.defaults, repository: ''})(image);
            this.logger.silly(`Parsed image='${image.name}' as '${JSON.stringify(image)}'`);

            // Copy over the data from parsed info
            serviceSpec = _.set('image')(_.merge(image)(/* Squash any undefined, null values */_.pickBy(_.identity)(serviceSpec.image)))(serviceSpec);
            // mysql:5.7.28@sha256:b38555e593300df225daea22aeb104eed79fc80d2f064fde1e16e1804d00d0fc
            serviceSpec = _.set('image.digest')(_.split('@')(serviceSpec.image.digest)[1])(serviceSpec);

            return serviceSpec;
        })(serviceSpecs));

        // Services are logically `grouped` by the stack they belong into
        serviceSpecs = _.sortBy('stack')(serviceSpecs);

        return serviceSpecs;
    }
}

module.exports = Docker;
