class Logger {
    constructor() {
        this._logger = null;
    }

    /* Getters and setters */
    get logger() {
        return this._logger;
    }

    set logger(logger) {
        this._logger = logger;
    }

    /* Public methods */
    async init() {
        const {createLogger, format, transports} = require('winston'), path = require('path'), os = require("os"),
            dns = require('dns').promises;
        require('winston-daily-rotate-file');

        const {address, family} = await dns.lookup(os.hostname(), (err, ipaddr, ipfamily) => ipaddr);
        const env = process.env.NODE_ENV || 'development';
        const dirname = path.resolve(path.dirname(process.argv[1]), 'logs');

        /*
        // Logging levels in winston conform to the severity ordering specified by RFC5424:
        // severity of all levels is assumed to be numerically ascending from most important to least important.
        const levels = {
            error: 0,
            warn: 1,
            info: 2,
            http: 3,
            verbose: 4,
            debug: 5,
            silly: 6
        };*/

        this._logger = createLogger({
            // change level if in dev environment versus production
            level: {production: 'verbose', development: 'silly'}[env],
            format: format.combine(
                format.label({label: path.basename(process.mainModule.filename), message: false}),
                format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
                // Custom data inserted into `info` object
                (format(info => ({
                    ...info,
                    node: process.version,
                    address,
                    family,
                    host: os.hostname(),
                    uptime: Math.floor(process.uptime()),
                    user: os.userInfo().username
                })))(/* new format instance */),
                format.printf(info => `${info.timestamp} ${info.uptime}s ${info.user} ${info.host}@${info.address} ${info.level.toUpperCase()} [${info.label}]: ${info.message}`)
            ),
            transports: [
                new transports.Console({    // Always to console as default
                    format: format.combine(
                        format.colorize()
                    )
                }),
                new transports.DailyRotateFile({    // Log to a daily rolling file alongwith console
                    filename: `${dirname}/somnus-%DATE%`,
                    extension: '.log',   // File extension to be appended to the filename.
                    datePattern: 'YYYY-MM-DD',
                    createSymlink: true, // Create a tailable symlink to the current active log file.
                    symlinkName: 'somnus.log',  // The name of the tailable symlink.
                    maxSize: '1024m',
                    maxFiles: '5d',
                    zippedArchive: true    // whether or not to gzip archived log files?
                }),
                /*new transports.File({
                    filename: path.join(__dirname, 'somnus.log'),
                    format: format.combine(
                        format.printf( info => `${info.timestamp} ${info.level} [${info.label}]: ${info.message}` )
                    )
                })*/
            ]
        });
    }
}

module.exports = new Logger();