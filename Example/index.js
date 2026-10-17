const { Authflow } = require('prismarine-auth')
const Realm = require('./Classes/Realm')
const Client = require('./Classes/Client')

const code = process.argv[2]
if (!code) throw new Error('Please provide a realm code')

;(async () => {
    const flow = new Authflow(null, './Cache', {
        flow: 'sisu',
        authTitle: '0000000048183522',
        deviceType: 'Android'
    });

    await flow.getXboxToken()
        .catch(() => {});

    const api = new Realm(flow);
    await api.init();

    const { body = null } = await api.getRealmInfo(code, false);
        // to get realmAddress (below) we need to be a member of the realm. (hence the *false*)
    if (!body?.id) throw new Error(`Realm not found: ${body}`)

    console.log(`Realm: ${body.name}`);

    const host = await api.getRealmIP(body.id);
    if (!host.body?.address) throw new Error(`Host not found: ${JSON.stringify(host)}`);
    
    console.log(`Host: ${host.body.address} ${host.body.networkProtocol}`);
    new Client(host.body.address, flow);

    console.log('Client initialized');
})()
