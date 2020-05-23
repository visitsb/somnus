# What is Somnus?
A NodeJs based docker image to keep services in a Docker stack always up-to-date to their latest images.

# Why another docker image?
I use [Docker stacks](https://docs.docker.com/compose/compose-file/#compose-file-structure-and-examples) in my environment. It was becoming pretty mundane to keep checking for latest images against my services on a periodic basis. The service in my stack also had dependencies within each other, and juggling each time to decide which service comes before which was a _pain_ during the manual update. I usually tore down my stack itself, updated the latest image tags against each service and then relaunched my stack fresh once again. Few services had to be on some specific version of an image, few could always go upto latest, and rest had a need to stick to specific tag prefixes. Not to mention, I also had to prune up any unused containers, dangling images - _manually_ every time I went through this update process.

I came across [Watchtower](https://containrrr.github.io/watchtower/) and did find it pretty impressive. However, it is feature-rich and has some advanced features into it that I found a little complicated to research into. Watchtower may've solved what I was after, but I decided to instead write a simple NodeJs script specific to my needs.

Here is how my script - Somnus (_In Roman mythology, Somnus ("sleep") is the personification of sleep_) works like this.

# How does Somnus work?
Somnus uses [Dockerode](https://github.com/apocas/dockerode) under the covers. Dockerode is an excellent library that simplifies working against the [Docker Engine API](https://docs.docker.com/engine/api/latest/). 
1. Invoke `somnus` as a standalone container like this-

    ```shell script
   $ docker run \
       -v /var/run/docker.sock:/var/run/docker.sock:ro \
       -v ./logs:/app/logs:rw \
       -v ./somnus.yml:/app/somnus.yml:ro \
       -w /app \
       somnus:latest --config somnus.yml
   ```    

    `somnus.yml` contains default settings to use Docker hub as well as `socketPath` to connect to your running Docker engine can be specified there. Please use the sample `somnus.yml` available in the project repo.
    
    Somnus currently supports the below parameters
    ```shell script
    Options:
    -v, --version              output the current version
    -c, --config <config.yml>  path to somnus.yml config
    -d, --dry-run              if specified, just do a dry run but do not actually update anything
    -h, --help                 output usage information
    ```
   
   In addition, the `logs` folder contains the log of the entire operation done by Somnus. Any older log files over 5 days are deleted automatically. Logs within 5 days are zipped to save space. The latest log is always available at `logs/somnus.log` 
2. All running Docker `services` are listed. All services across all Docker stacks are listed. 
3. Services are parsed using [Docker labels](https://docs.docker.com/config/labels-custom-metadata/). Usually the defaults are sufficient, but if these are specified on the service as label, then that value will be used instead. 

   Most likely, you'll want to use `somnus.defaults.enable` and `somnus.defaults.order` labels compared to the rest of them.
   
   All defaults except `enable`, `order` are specified in `somnus.yml`.

    |Label|Default Value|Description|
    |:---|:---|:---|
    |`somnus.defaults.enable`|`true`|Set this label on a service to enable or disable this for Somnus to target for autoupdate.|
    |`somnus.defaults.order`|`0`|Determines the order in which services within a Docker stack should be updated. Somnus will update any services with same `order` in parallel. <br><br>Lower numbered `order` is updated first then next higher `order` in sequence. Useful to explicitly control a bunch of related services within a stack to get updated before others in sequence. <br><br>Somnus will wait until the updated service has achieved `completed` state which means the updated service is fully up and running.<br><br>Note: All Docker Stacks are updated in parallel. `order` matters only within that stack.|
    |`somnus.defaults.latest.tag`|`latest`|Specify which tag represents the `latest` image for the service.<br><br>This value can be partial tag such as `alpine`, `buster` used in some popular images, or it could be a few characters such as `5` for example to stick to `5x` series of `mysql`.<br><br>Behind the scenes the tags are matched for similarity using a [Levenshtein distance](https://en.wikipedia.org/wiki/Levenshtein_distance) using [leven](https://github.com/sindresorhus/leven) and then the longest match is used to determine the latest image tag to update to.<br><br>Tip: Use `--dry-run` when running somuns to check if the latest tag is what you expect it to be.|
    |`somnus.defaults.registry`|`hub.docker.com`|Somnus uses the official [Docker Hub](https://hub.docker.com/) for updates by default.|
    |`somnus.defaults.version`|`v2`|Used to create the standard Docker Hub url to fetch latest tags for an image|
    |`somnus.defaults.namespace`|`library`|Default namespace for official Docker images. <br><br>For images that use a custom namespace e.g. `containous/whoami`the namespace is automatically adjusted to fetch the correct tags from that custom namespace.|
    |`somnus.defaults.architecture`|`amd64`|Used to determine to correct image tag suitable for architecture on which current Docker Engine is running.|
    |`somnus.defaults.os`|`linux`|Used to determine the suitable OS version for the image tag.|
4. Each service is checked to see if it has a newer image tag available. 
5. If a newer image tag is available then the service is updated to use that tag. Somnus waits until the service reports `completed` as it's status after updating. Somnus then proceeds to the next service to update based on `order`.
6. As a final step, any stopped containers, unused images are removed.

# How do I install Somnus?
Once you verify that the above `docker run` command works for your stack, then declare `somnus` like any other service in your Docker stack and you're good to go. 

Note: You only need to define `somnus` once in one of your Docker stacks, perhaps a master stack. Somnus will keep updating all services across all stacks currently deployed in your Docker engine.

```yaml
  # My example service that I want to always keep up-to-date using Somnus
  mongo:
    image: mongo:4.2.1-bionic
    labels:
      # Somnus autoupdate tags.  Latest 'bionic' tags for mongo should be kept up-to-date.
      - "somnus.defaults.latest.tag=bionic"
      - "somnus.defaults.enable=true"
    command: ["mongod", "--config", "/etc/mongod.conf"]    
    ports:
     - ...
    volumes:
       - ...
    environment:
      - ...
  # Declare Somnus like any other service in your stack. Since just one global service is sufficient
  # you can specify the service placement to be `global` and restricted to a `manager` node.
  somnus:
        image: visitsb/somnus:1.0
        volumes:
           - /var/run/docker.sock:/var/run/docker.sock:ro
           - /somnus/somnus.yml:/app/somnus.yml:ro
           - /somnus/logs:/app/logs:rw
        deploy:
          mode: global
          placement:
          constraints:
            - node.role == manager
        ... 
```

By default, `somnus.yml` has a `schedule` to auto update once daily. You can change the schedule using a [different](https://www.easycron.com/faq/What-cron-expression-does-easycron-support) schedule. 

Restart `somnus` service to pick up the new schedule and somnus will happily keep all of your services up-to-date.

# Any problems?
Please use Github to post your issues, suggestions. PRs are welcome too. Let Somnus save you some quality time in your Docker infrastructure.