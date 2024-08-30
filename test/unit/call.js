
const expect = require( "chai" ).expect
const srf = require( "../mock/srf.js" )
const EventEmitter = require('events')
const sdptransform = require( "sdp-transform" )


describe( "call.js", function() {

  it( "Re-invite codec negotiation", async function() {

    const dialog = new EventEmitter()
    const srfscenario = new srf.srfscenario()
    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    call._addevents(dialog)
    call.sdp.local = call.sdp.remote

    let response
    const req = {}
    req.msg = {
      method: 'INVITE',
      uri: 'sip:bob@example.com',
      headers: {
        to: { uri: 'sip:bob@example.com' },
        from: { uri: 'sip:alice@example.com', params: { tag: '12345' } },
        'call-id': 'a84b4c76e66710',
        cseq: { method: 'INVITE', seq: 1 },
        contact: [{ uri: 'sip:alice@client.example.com' }],
        via: [
          {
            version: '2.0',
            protocol: 'UDP',
            host: 'client.example.com',
            port: 5060,
            params: { branch: 'z9hG4bK776asdhds' },
          },
        ],
        'content-type': 'application/sdp',
      },
      body: `v=0
o=alice 2890844526 2890844526 IN IP4 client.example.com
s=-
c=IN IP4 client.example.com
t=0 0
m=audio 49170 RTP/AVP 0 106
a=rtpmap:0 PCMU/8000
a=rtpmap:106 opus/48000/2`,
    }

    await new Promise((resolve) => {
      const res = { 
        send: (status, data) => {
        response = data
        resolve()
      } }
      dialog.emit("modify", req, res)
    })
    
    await call.hangup()
    const parsed = sdptransform.parse( response.body )
    expect(parsed.media[0].payloads).to.equal(106)
  })

  it( "set remote name and id", async function() {
    const srfscenario = new srf.srfscenario()

    let newcallcalled = false
    srfscenario.options.em.on( "call.new", ( /*newcall*/ ) => {
      newcallcalled = true
    } )

    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    call.calleridname = "foo"
    call.callerid = "123456789"

    // TODO we set the remote id using "setremoteid", but getter returns it as "user" 
    // the names mismatch and can be confusing, we might consider some polishing here?
    expect(call.callerid.name).equals("foo")
    expect(call.callerid.user).equals("123456789")
    expect( newcallcalled ).to.be.true

    await call.hangup()
  } )

} )
