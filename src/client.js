const { Connection } = require('./connection.js')

const { authenticate } = require('./client/auth.js')
const { createDeserializer, createSerializer } = require('./transforms/serializer.js')

const { NethernetClient } = require('./nethernet.js')
const { NethernetJSONRPC } = require('./websocket/signal-jsonrpc.js')

const { v4 } = require('uuid')

const JWT = require('jsonwebtoken')
const crypto = require('crypto')

const steve = require("./skins/Steve.json")

class Client extends Connection {
    connection

    constructor(options) {
        super()
        this.options = { ...options }
        this.compressionAlgorithm = 'deflate'
        this.compressionThreshold = 512
        this.compressionLevel = options.compressionLevel

        this.nethernet = {}
    }

    async init() {
        if (!this.options.networkId) return this.disconnect(`typeof network ID was ${typeof this.options.networkId ?? this.options.networkId}`);

        this.serializer = createSerializer()
        this.deserializer = createDeserializer()

        this.ecdhKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: "secp384r1" })
        this.clientX509 = this.ecdhKeyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
        this.privateKeyPEM = this.ecdhKeyPair.privateKey.export({ format: 'pem', type: 'sec1' })

        await authenticate(this, this.options)

        this.connection = new NethernetClient({ networkId: this.options.networkId, token: this.token, ecdhKeyPair: this.ecdhKeyPair })
        this.nethernet.signalling = new NethernetJSONRPC(this.connection.nethernet.networkId, this.options.authflow, this.options.version || "1.26.45", this.options.networkId)

        await this.nethernet.signalling.connect()

        this.connection.nethernet.credentials = this.nethernet.signalling.credentials
        this.connection.nethernet.signalHandler = this.nethernet.signalling.write.bind(this.nethernet.signalling)
        this.nethernet.signalling.on('signal', signal =>
            this.connection.nethernet.handleSignal(signal)
                .catch(error => this.close(error.message))
        )

        this.nethernet.signalling.on('error', () => { })
        this.connection.nethernet.on('debug', () => { })

        this.emit('connectionAllowed')
    }

    connect() {
        if (!this.connection || !this.nethernet.signalling) throw new Error('Connect not currently allowed')

        this.connection.onConnected = () => 
            this.write('request_network_settings', { client_protocol: this.options?.protocolVersion || 2193 });

        this.connection.onCloseConnection = (reason) => { this.close(reason) }
        this.connection.onEncapsulated = this.onEncapsulated
        this.connection.connect().catch(error => this.close(error.message))
    }

    onEncapsulated = (encapsulated) => {
        this.handle(Buffer.from(encapsulated.buffer))
    }

    sendLogin() {
        const PlayFabId = String(this.tokenData?.mid || "aed7e8a4d485a49a").toLowerCase()

        const payload = {
            ClientRandomId: String(Date.now()),
            GameVersion: this.options?.version || "1.26.45",
            CurrentInputMode: 2,
            DefaultInputMode: 2,

            SelfSignedId: "",
            GUIScale: -1,
            LanguageCode: ["en_US", "en_GB"][Math.floor(Math.random() * 2)],

            DeviceId: v4().replace(/-/g, ""),
            DeviceOS: 1,
            DeviceModel: "SAMSUNG SM-G955U",
            UIProfile: 1,
            MaxViewDistance: 10,
            MemoryTier: 3,
            PlatformType: 1,

            GraphicsMode: 1,
            TrustedSkin: steve.PersonaSkin,
            OverrideSkin: false,
            FilterProfanity: false,

            ThirdPartyName: this.tokenData?.xname || "Meow meow.",
            ProfileHash: "",

            PlatformOnlineId: "",
            PlatformOfflineId: "",

            IsEduMode: false,
            TenantId: null,
            ADRole: null,

            IsEditorMode: false,
            ClientIsEditorCapable: true,
            ClientEditorConnectionIntent: 2,

            CompatibleWithClientSideChunkGen: true,
            ...steve,
            ...this.options?.skinData
        }

        const updatePlayFabId = data => btoa(atob(data).replaceAll('aed7e8a4d485a49a-5', `${PlayFabId}-2`))

        payload.SkinId = `persona-${PlayFabId}-2`
        payload.SkinGeometryData = updatePlayFabId(payload.SkinGeometryData)
        payload.SkinResourcePatch = updatePlayFabId(payload.SkinResourcePatch)

        this.write('login', {
            protocol_version: this.options?.protocolVersion || 2193,
            tokens: {
                identity: JSON.stringify({ AuthenticationType: 0, Certificate: undefined, Token: this.token }),
                client: JWT.sign(payload, this.ecdhKeyPair.privateKey, { algorithm: 'ES384', header: { x5u: this.clientX509 } })
            }
        })
    }

    disconnect(reason = 'Client leaving') {
        if (!this.nethernet) return;

        this.close(reason)
    }

    close(reason) {
        if (this.nethernet) this.emit('close', reason)

        this.batch = null
        this.connection?.close()

        this.removeAllListeners()

        if (this.nethernet?.signalling) this.nethernet.signalling.destroy()

        this.nethernet = {}
    }

    readPacket(packet) {
        let des
        try { des = this.deserializer.parsePacketBuffer(packet) }
        catch (e) { return this.emit('error', e); }

        switch (des.data.name) {
            case 'network_settings':
                this.compressionThreshold = des.data.params?.compression_threshold
                this.compressionReady = true
                this.batch.updateCompressionSettings(this)

                this.sendLogin()
                break;

            case 'server_to_client_handshake':
                this.write('client_to_server_handshake', {})
                break;

            case 'disconnect':
                this.emit('kick', des.data.params)
                this.close()
                break;

            case 'item_registry':
                des.data.params.itemstates?.forEach(state => {
                    if (state.name === 'minecraft:shield') {
                        this.serializer.proto.setVariable('ShieldItemID', state.runtime_id)
                        this.deserializer.proto.setVariable('ShieldItemID', state.runtime_id)
                    }
                })
                break;
        }

        this.emit(des.data.name, des.data.params)
    }
}

module.exports = { Client }