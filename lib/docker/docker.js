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

        let serviceSpecs = await jq.run('.[] | { id: .ID, name: .Spec.Name, stack: .Spec.Labels."com.docker.stack.namespace", enable: .Spec.TaskTemplate.ContainerSpec.Labels."somnus.defaults.enable", image: { name: .Spec.Labels."com.docker.stack.image", digest: .Spec.TaskTemplate.ContainerSpec.Image }, defaults : { latest: { tag: .Spec.TaskTemplate.ContainerSpec.Labels."somnus.defaults.latest.tag" }}}', JSON.stringify(servicesList),
            {input: 'string', output: 'json', slurp: false});
        serviceSpecs = await jq.run('.', serviceSpecs, {input: 'string', output: 'json', slurp: true}); // Slurp up the results into an array

        serviceSpecs = await Promise.all(_.map(async (serviceSpec) => { // Default to `enable=true`
            serviceSpec.enable = _.eq('true')(_.defaultTo('true')(_.get('enable')(serviceSpec)));
            return serviceSpec;
        })(serviceSpecs));

        serviceSpecs = _.filter((serviceSpec) => serviceSpec.enable)(serviceSpecs);
        this.logger.verbose(`Got '${serviceSpecs.length}' enabled docker services...`);

        serviceSpecs = await Promise.all(_.map(async (serviceSpec) => {
            let image = parse(serviceSpec.image.name);
            image = _.pickBy(_.identity)(image); // Squash any undefined, null values
            image = _.defaults({...this.config.docker.defaults, repository: ''})(image);
            this.logger.silly(`Parsed image='${image.name}' as '${JSON.stringify(image)}'`);

            // Copy over the data from parsed info
            serviceSpec.image = _.merge(image)(serviceSpec.image);
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
