const { Client: BedrockClient } = require('../../index')

class Client extends BedrockClient {
    constructor(networkId, authflow) {
        super({ authflow, networkId })

        this.dateNow = Date.now()
        this.networkId = networkId;

        this.#connect()
    }

    async #connect() {
        try {
            await Promise.race([
                new Promise(resolve => {
                    this.once('connectionAllowed', resolve);
                    this.init();
                }),

                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), 15000))
            ]);

            this.setupListeners();
            this.connect();
        } catch (error) {
            if (error.message === 'Connection timed out') this.close('Connection timeout (Client.js entry)');

            console.error('Connection failed:', error);
        }
    }

    setupListeners() {
        this.on('start_game', _ => 
            console.log(`Client connected to ${this.networkId} after ${Date.now() - this.dateNow}MS`)
        )
    }
}

module.exports = Client
