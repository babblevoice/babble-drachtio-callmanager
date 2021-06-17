
const { v4: uuidv4 } = require( "uuid" )

const url = require( "url" )
const querystring = require( "querystring" )

const digestauth = require( "drachtio-mw-digest-auth" )
const parseuri = require( "drachtio-srf" ).parseUri
const sdpgen = require( "babble-projectrtp" ).sdp
const callstore = require( "./store.js" )

/*
Not fully complete - but covers all we need.
*/
const hangupcodes = {
  UNALLOCATED_NUMBER: { "reason": "UNALLOCATED_NUMBER", "sip": 404 },
  USER_BUSY: { "reason": "USER_BUSY", "sip": 406 },
  NO_USER_RESPONSE: { "reason": "NO_USER_RESPONSE", "sip": 408 }, /* Timeout */
  USER_GONE: { "reason": "USER_GONE", "sip": 410 },
  NO_ANSWER: { "reason": "NO_ANSWER", "sip": 480 }, /* Temporarily Unavailable */
  LOOP_DETECTED: { "reason": "LOOP_DETECTED", "sip": 482 },
  INVALID_NUMBER_FORMAT: { "reason": "INVALID_NUMBER_FORMAT", "sip": 484 },
  USER_BUSY: { "reason": "USER_BUSY", "sip": 486 },
  NORMAL_CLEARING: { "reason": "NORMAL_CLEARING", "sip": 487 },
  ORIGINATOR_CANCEL: { "reason": "ORIGINATOR_CANCEL", "sip": 487 },
  USER_NOT_REGISTERED: { "reason": "USER_NOT_REGISTERED", "sip": 487 },
  BLIND_TRANSFER: { "reason": "BLIND_TRANSFER", "sip": 487 },
  ATTENDED_TRANSFER: { "reason": "ATTENDED_TRANSFER", "sip": 487 },
  LOSE_RACE: { "reason": "LOSE_RACE", "sip": 487 },
  PICKED_OFF: { "reason": "PICKED_OFF", "sip": 487 },
  MANAGER_REQUEST: { "reason": "ATTENDED_TRANSFER", "sip": 487 },
  REQUEST_TERMINATED: { "reason": "MANAGER_REQUEST", "sip": 487 },
  INCOMPATIBLE_DESTINATION: { "reason": "INCOMPATIBLE_DESTINATION", "sip": 488 },
  SERVER_ERROR: { "reason": "SERVER_ERROR", "sip": 500 },
  FACILITY_REJECTED: { "reason": "FACILITY_REJECTED", "sip": 501 },
  DESTINATION_OUT_OF_ORDER: { "reason": "DESTINATION_OUT_OF_ORDER", "sip": 502 },
  CALL_REJECTED: { "reason": "CALL_REJECTED", "sip": 603 }
}

const eventdefs = [ "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "#", "A", "B", "C", "D" ]
var consolelog = ( u, m ) => {}
var singleton

class call {

  constructor( req, res ) {
    this.uuid = uuidv4()

    consolelog( this, "new call" )
    this.direction = "initiator"

    /* state */
    this.state = {
      "trying": false,
      "ringing": false,
      "established": false,
      "canceled": false,
      "destroyed": false
    }


    this.type = "unknown"

    /* an array of channels */
    this.channels = []

    /* UACs we create */
    this.children = new Set()
    this.parent = false

    this.uactimeout = singleton.options.uactimeout

    if( undefined !== req ) {
      /* We have received the INVITE */
      this.source = {}
      this.source.address = req.source_address
      this.source.port = req.source_port
      this.source.protocol = req.protocol

      this.sip = {}
      this.sip.callid = req.getParsedHeader( "call-id" )
      this.sip.tags = {}
      this.sip.tags.remote = req.getParsedHeader( "from" ).params.tag
      this.sip.tags.local = ""

      this.req = req
      this.res = res
      this.type = "uas"

      this.req.on( "cancel", () => this._oncanceled() )
    }

    this.receivedtelevents = ""

    this.authresolve = false
    this.authreject = false
    this.authtimout = false

    this.waitforeventstimer = false
    this.waitforeventsresolve = false
    this.waitforeventsreject = false

    this.newuactimer = false
    this.newuacresolve = false
    this.newuacreject = false

    this.answerresolve = false
    this.answerreject = false

    this.waitforhangupresolve = false
    this.waitforhangupreject = false

    this.held = false

    this.startat = Math.floor( +new Date() / 1000 )
    this.answerat = 0
    this.endat = 0
  }

  /*
  State functions
  Get state as a string
  According to state machine in RFC 4235, we send early if we have received a 1xx with tag
  I am going to use 100 and 180 - which should be the same.
  */

  get hasmedia() {
    if( this.held ) return false
    return this.state.established
  }

  set trying( s ) {
    if( this.state.trying != s ) {
      this.state.trying = s
    }
  }

  get trying() {
    return this.state.trying
  }

  set ringing( s ) {
    if( this.state.ringing != s ) {
      this.state.ringing = s
    }
  }

  get ringing() {
    return this.state.ringing
  }

  set established( s ) {
    if( this.state.established != s ) {
      this.answerat = Math.floor( +new Date() / 1000 )
      this.state.established = s
    }
  }

  get established() {
    return this.state.established
  }

  set canceled( s ) {
    if( this.state.canceled != s ) {
      this.endat = Math.floor( +new Date() / 1000 )
      this.state.canceled = s
    }
  }

  get canceled() {
    return this.state.canceled
  }

  set destroyed( s ) {
    if( this.state.destroyed != s ) {
      this.endat = Math.floor( +new Date() / 1000 )
      this.state.destroyed = s
    }
  }

  get destroyed() {
    return this.state.destroyed
  }

  get statestr() {
    if( this.state.established ) {
      return "confirmed"
    }

    if( this.state.ringing ) {
      return "early"
    }

    if( this.state.trying ) {
      return "proceeding"
    }

    if( this.state.destroyed ) {
      return "terminated"
    }

    return "trying"
  }

  get remote() {
    // TODO
    return {
      "uri": "sip:1000@bling.babblevoice.com",
      "display": "Some Name"
    }
  }

  get duration() {
    return parseInt( Math.floor( +new Date() / 1000 ) - this.startat )
  }

  /* Delink calls logically */
  detach() {
    if( false !== this.parent ) {
      this.parent.children.delete( this )
    }

    for( let child of this.children ) {
      child.parent = false
    }

    this.parent = false
    this.children.clear()
  }

  newuac( contact, options ) {

    return new Promise( async ( resolve, reject ) => {

      let newcall = false
      try {
        newcall = new call()
        newcall.type = "uac"
        newcall.parent = this
        newcall.newuacresolve = resolve
        newcall.newuacreject = reject
        newcall.direction = "recipient"

        this.children.add( newcall )

        consolelog( this, "New UAC for " + contact )

        newcall.newuactimer = setTimeout( () => {
          consolelog( newcall, "UAC timer fired" )
          newcall.hangup( hangupcodes.NO_USER_RESPONSE )

        }, this.uactimeout )

        newcall.options = {
            headers: {
            }
          }

        newcall.options = { ...singleton.options, ...newcall.options, ...options }

        let lateorearly = "with sdp"
        if( undefined !== newcall.options.late && true === newcall.options.late ) {
          newcall.options.noAck = true // this is a MUST for late negotiation
          lateorearly = "without sdp"
        } else {
          newcall.audio = await singleton.rtp.channel()
          let localsdp = sdpgen.create().addcodecs( newcall.options.preferedcodecs )
          localsdp.setchannel( newcall.audio )

          /* Create our SDP */
          newcall.options.localSdp = localsdp.toString()
        }

        let dlg = await singleton.options.srf.createUAC( contact, newcall.options,
          {
            cbRequest: ( err, req ) => {
              consolelog( this, `Sending invite for ${contact} (${lateorearly})` )
              newcall.req = req
              newcall.trying = true

              newcall.sip = {}
              newcall.sip.callid = req.getParsedHeader( "call-id" )
              newcall.sip.tags = {}
              newcall.sip.tags.local = req.getParsedHeader( "from" ).params.tag
              newcall.sip.tags.remote = ""
            },
            cbProvisional: ( res ) => {
              consolelog( this, "Received provisional for " + contact )
              newcall.res = res
              if( 180 === res.status ) {
                newcall._onring()
              }

              if( true === newcall.canceled ) {
                newcall.hangup()
              }
            }
          } )

          newcall.dialog = dlg
          newcall._onanswer()

        } catch ( err ) {

          if ( undefined !== err.status ) {
            let reason = hangupcodes.REQUEST_TERMINATED
            if( 486 === err.status ) {
              reason = hangupcodes.USER_BUSY
            }

            if( newcall ) {
              newcall._onhangup( "wire", reason )

              if( false !== newcall.newuacreject ) newcall.newuacreject( this )
              if( false !== newcall.newuactimer ) clearTimeout( newcall.newuactimer )

              newcall.newuactimer = false
              newcall.newuacresolve = false
              newcall.newuacreject = false
            }

          } else {
            consolelog( this, "New UAC Error: " + err )
          }
        }
    } )
  }

  /* Called from newuac when we receive a 180 */
  _onring() {
    this.ringing = true
    if( false !== this.parent ) {
      consolelog( this, "received 180 ringing" )
      this.parent.ring()
    }
  }

  /* Called from newuac when we are answered and we have a dialog, this - child call */
  _onanswer() {
    if( undefined !== this.parent ) {
      if( undefined !== this.parent.children ) {
        for( let child of this.parent.children ) {
          if( child.uuid !== this.uuid ) {
            child.hangup()
          }
        }
      }
      this.parent.children.clear()
      this.parent.children.add( this )
    }

    clearTimeout( this.newuactimer )
    this.newuactimer = false

    if( true === this.options.noAck ) {
      this._onlatebridge()
    } else {
      this._onearlybridge()
    }
  }

  async _onearlybridge() {
    /*
      On an early negotiation we have already sent our sdp without
      knowing what the otherside is going to offer. We now have the
      other sides SDP so we can work out the first common CODEC.
    */

    let remotesdp = sdpgen.create( this.dialog.remote.sdp )

    try {
      if( this.parent.established ) {

        this.selectedcodec = remotesdp.intersection( this.options.preferedcodecs, true )

        this.audio.target( remotesdp )
        this.audio.mix( this.parent.audio )

      } else {
        let remotecodecs = remotesdp.intersection( this.options.preferedcodecs )

        this.audio.target( remotesdp )

        consolelog( this, "Answering parent with prefered CODECs: " + remotecodecs )
        await this.parent.answer( { "preferedcodecs": remotecodecs } )

        this.audio.mix( this.parent.audio )

        this.established = true
        this.sip.tags.remote = this.dialog.sip.remoteTag

        if( false !== this.newuactimer ) clearTimeout( this.newuactimer )
        this.newuactimer = false

        let r = this.newuacresolve
        this.newuacresolve = false
        this.newuacreject = false

        r( this )

      }
    } catch ( err ) {
      console.log( err )
      if( false !== this.newuacreject ) this.newuacreject( this )
      if( false !== this.newuactimer ) clearTimeout( this.newuactimer )

      this.newuactimer = false
      this.newuacresolve = false
      this.newuacreject = false
    }
  }

  _onlatebridge() {
    let remotesdp = sdpgen.create( this.dialog.sdp )

    /* We now have 2 calls, we may need to answer the parent */
    /* We have this.dialog (srf dialog object) */
    if( this.parent.established ) {
      this.selectedcodec = remotesdp.intersection( this.options.preferedcodecs, true )
      consolelog( this, "remote codec chosen: " + this.selectedcodec )

      singleton.rtp.channel( remotesdp.select( this.selectedcodec ) )
        .then( ch => {
          this.channels.push( ch )
          this._addchannelevents( ch )

          let localsdp = sdpgen.create().addcodecs( this.selectedcodec ).setchannel( ch )
          if( true === this.options.rfc2833 ) {
            localsdp.addcodecs( "2833" )
            ch.rfc2833( 101 )
          }

          this.dialog.ack( localsdp.toString() )
            .then( ( dlg ) => {
              this.dialog = dlg
              this.addevents( this.dialog )
              this.audio.mix( this.parent.audio )

              this.established = true
              this.sip.tags.remote = dlg.sip.remoteTag

              if( false !== this.newuactimer ) clearTimeout( this.newuactimer )
              this.newuactimer = false

              this.newuacresolve( this )
              this.newuacresolve = false
              this.newuacreject = false
            } )
        } )
        .catch( () => {
          if( false !== this.newuacreject ) this.newuacreject( this )
          if( false !== this.newuactimer ) clearTimeout( this.newuactimer )

          this.newuactimer = false
          this.newuacresolve = false
          this.newuacreject = false
          return
        } )
    } else {
      /* parent is not established */

      /* We need to add some code to allow transcoding if permitted
      i.e. 1. if both sides support the same codec, choose that codec,
      otherwise 2. is transcoding enabled then 3. choose other codec we are
      capable of transocding to. */
      let remotecodecs = remotesdp.intersection( this.options.preferedcodecs )
      consolelog( this, "remote codecs (late negotiation) chosen: " + remotecodecs )

      this.parent.answer( { "preferedcodecs": remotecodecs } )
        .then( () => {

          /*
          TODO - possible bug - what if both sides don't support the same codec
          */
          this.selectedcodec = this.parent.selectedcodec

          singleton.rtp.channel( remotesdp.select( this.selectedcodec ) )
            .then( ch => {
              let localsdp = sdpgen.create().addcodecs( this.selectedcodec ).setchannel( ch )

              this.channels.push( ch )
              this._addchannelevents( ch )

              if( true === this.options.rfc2833 ) {
                localsdp.addcodecs( "2833" )
                ch.rfc2833( 101 )
              }

              this.dialog.ack( localsdp.toString() )
                .then( ( dlg ) => {
                  this.dialog = dlg
                  this.addevents( this.dialog )
                  this.audio.mix( this.parent.audio )

                  this.established = true
                  this.sip.tags.remote = dlg.sip.remoteTag

                  if( false !== this.newuactimer ) clearTimeout( this.newuactimer )
                  this.newuactimer = false

                  let r = this.newuacresolve
                  this.newuacresolve = false
                  this.newuacreject = false

                  r( this )
                } )
            } )
        } )
        .catch( () => {
          if( false !== this.newuacreject ) this.newuacreject( this )
          if( false !== this.newuactimer ) clearTimeout( this.newuactimer )

          this.newuactimer = false
          this.newuacresolve = false
          this.newuacreject = false
        } )
    }
  }

  get destination() {
    if( undefined !== this.referingtouri ) {
      return parseuri( this.referingtouri )
    }
    return parseuri( this.req.msg.uri )
  }

  /* Sometimes we don't care who if we are the parent or child - we just want the other party */
  get other() {
    if( false !== this.parent ) {
      return this.parent
    }

    for( const child of this.children ) {
      if( child.established ) {
        return child
      }
    }

    return false
  }

  /*
    auth - returns promise.
  */
  auth() {
    return new Promise( ( resolve, reject ) => {

      if( undefined !== this.referingtouri ) {
        /* if we have been refered the call has been authed to proceed by the refering party */
        resolve()
        return
      }

      this.authresolve = resolve
      this.authreject = reject

      this.authtimout = setTimeout( () => {
        this.authreject()
        this.authresolve = false
        this.authreject = false
        this.authtimout = false

        this.hangup( hangupcodes.NO_USER_RESPONSE )

      }, 50000 )

      let fromparts = parseuri( this.req.getParsedHeader( "From" ).uri )

      digestauth( {
        "proxy": true, /* 407 or 401 */
        "passwordLookup": ( username, realm, cb ) => {
          singleton.options.userlookup( username, realm )
            .then( ( u ) => {
              cb( false, u.secret )
            } )
            .catch( () => {
              cb( false, false )
            } )
        },
        "realm": fromparts.host
      } )( this.req, this.res, () => {} )
    } )
  }

  /* Private - called by us we handle the auth challenge in this function */
  _onauth( req, res ) {

    /* are we waiting for an auth ?*/
    if( false !== this.authresolve ) {

      this.req = req
      this.res = res

      this.req.on( "cancel", () => this._oncanceled() )

      consolelog( this, "checking auth" )

      let fromparts = parseuri( req.getParsedHeader( "From" ).uri )

      digestauth( {
        "proxy": true, /* 407 or 401 */
        "passwordLookup": ( username, realm, cb ) => {
          singleton.options.userlookup( username, realm )
            .then( ( u ) => {
              cb( false, u.secret )
            } )
            .catch( () => {
              cb( false, false )
            } )
        },
        "realm": fromparts.host
      } )( this.req, this.res, () => {
        consolelog( this, "resolving auth" )
        if( false !== this.authtimout ) {
          clearTimeout( this.authtimout )
          this.authtimout = false
        }

        this.entity = {}
        this.entity.username = this.req.authorization.username
        this.entity.realm = this.req.authorization.realm
        this.entity.uri = this.req.authorization.username + "@" + this.req.authorization.realm

        callstore.set( this )

        this.authresolve()
        this.authresolve = false
        this.authreject = false
        this.authtimout = false

        callstore.getbyentity()
          .then( ( s ) => {
            singleton.options.em.emit( "presence.dialog.out", {
              "entity": this.entity.uri,
              "username": this.entity.username,
              "realm": this.entity.realm,
              "display": "Miss Piggy",
              "update": this,
              "all": s
            } )
          } )
          .catch( () => {} )
      } )
    }
  }

  _oncanceled( req, res ) {
    consolelog( this, "client canceled" )
    this.canceled = true

    for( let child of this.children ) {
      child.hangup()
    }
  }

  _tevent( e ) {
    this.receivedtelevents += eventdefs[ e ]

    if( undefined !== this.eventmatch ) {
      let ourmatch = this.receivedtelevents.match( this.eventmatch )
      if( null !== ourmatch ) {
        if( false !== this.waitforeventsresolve ) {
          this.waitforeventsresolve( ourmatch[ 0 ] )
        }
        if( false !== this.waitforeventstimer ) {
          clearTimeout( this.waitforeventstimer )
        }

        this.waitforeventsresolve = false
        this.waitforeventsreject = false
        this.waitforeventstimer = false
      }
    }
  }

  waitforevents( match = /[0-9A-D\*#]/, timeout = 30000 ) {

    return new Promise( ( resolve, reject ) => {

      this.waitforeventstimer = setTimeout( () => {
        if( false === this.waitforeventsreject ) {
          this.waitforeventsreject()
        }
        this.waitforeventsreject = false
        this.waitforeventsresolve = false
        this.waitforeventstimer = false

      }, timeout )

      if( typeof match === "string" ){
        this.eventmatch = new RegExp( match )
      } else {
        this.eventmatch = match
      }

      /* All (previous) promises must be resolved */
      if( false !== this.waitforeventsreject ) {
        this.waitforeventsreject()
      }

      if( false !== this.waitforeventstimer ) {
        clearTimeout( this.waitforeventstimer )
      }

      this.waitforeventsresolve = resolve
      this.waitforeventsreject = reject
    } )
  }

  ring() {
    if( !this.ringing && "uas" === this.type ) {
      this.ringing = true
      this.res.send( 180, {
        headers: {
           "User-Agent": "project",
           "Supported": "replaces"
         }
      } )
    }
  }

  busy() {
    this.hangup( hangupcodes.USER_BUSY )
  }

  /*
    answer - returns promise.
    Answer the call and store a channel which can be used.
  */
  answer( options = {} ) {
    return new Promise( ( resolve, reject ) => {

      if( this.canceled ) {
        reject()
        return
      }

      if( this.established ) {
        resolve()
        return
      }

      this.answerresolve = resolve
      this.answerreject = reject

      options = { ...singleton.options, ...this.options, ...options }

      let remotesdp = sdpgen.create( this.req.msg.body )

      /* options.preferedcodecs may have been narrowed down so we still check singleton as well */
      this.selectedcodec = remotesdp.intersection( options.preferedcodecs, true )
      if( false === this.selectedcodec ) {
        this.selectedcodec = remotesdp.intersection( singleton.options.preferedcodecs, true )
      }

      consolelog( this, "answer call with codec " + this.selectedcodec )

      singleton.rtp.channel( remotesdp.select( this.selectedcodec ) )
        .then( ch => {
          consolelog( this, "channel opened" )

          this._addchannelevents( ch )

          this.channels.push( ch )
          let localsdp = ch.localsdp.addcodecs( this.selectedcodec )

          if( this.canceled ) {
            this.answerreject()

            this.answerresolve = false
            this.answerreject = false
            return
          }

          if( true === singleton.options.rfc2833 ) {
            localsdp.addcodecs( "2833" )
            ch.rfc2833( 101 )
          }

          singleton.options.srf.createUAS( this.req, this.res, {
            localSdp: localsdp.toString(),
            headers: {
               "User-Agent": "project",
               "Supported": "replaces"
             }
          } )
          .then( ( dialog ) => {
            this.established = true
            this.dialog = dialog
            this.sip.tags.local = dialog.sip.localTag

            this.addevents( this.dialog )
            this.answerresolve()

            this.answerresolve = false
            this.answerreject = false
          } )
        } ).catch( ( err ) => {
          this.answerreject()

          this.answerresolve = false
          this.answerreject = false
        } )
    } )
  }

  _addchannelevents( ch ) {
    ch.on( "telephone-event", ( e ) => this._tevent( e ) )

    // If our RTP server closes on us then it will be media timout */
    ch.on( "close", ( e ) => this.hangup( hangupcodes.USER_GONE ) )
  }

  _hold() {

    consolelog( this, "Placing call on hold" )
    if( this.held ) return
    this.held = true

    this.audio.setaudiodirection( "inactive" )

    let other = this.other
    if( other ) {
      this.audio.unmix()
      other.audio.play( singleton.options.moh )
    }
  }

  _unhold() {
    consolelog( this, "Taking call off hold" )
    if( !this.held ) return
    this.held = false

    let other = this.other
    if( other ) {
      this.audio.mix( other.audio )
    }

    this.audio.setaudiodirection( "sendrecv" )

  }

  _notifyreferfail() {
    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer;id=" + this.referreq.get( "cseq" ).match( /(\d+)/ )[ 0 ],
        "Subscription-State": "terminated;reason=error",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 400 Ok\r\n"
    }

    return this.dialog.request( opts )
  }

  _notifyrefercomplete() {
    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer;id=" + this.referreq.get( "cseq" ).match( /(\d+)/ )[ 0 ],
        "Subscription-State": "terminated;reason=complete",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 200 Ok\r\n"
    }

    return this.dialog.request( opts )
  }

  _notifyreferstart() {
    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer;id=" + this.referreq.get( "cseq" ).match( /(\d+)/ )[ 0 ],
        "Subscription-State": "active;expires=60",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 100 Trying\r\n"
    }

    return this.dialog.request( opts )
  }

  _modifyforxfer() {
    return this.dialog.modify( this.audio.localsdp.toString() )
  }

  addevents( dialog ) {

    /* Drachtio doesn't appear to have finished SE support, i.e. it sends
    a regular INVITE when we set the Supported: timer and Session-Expires headers
    but it doesn't appear to indicate to us when it does fail. It most cases our
    RTP stall timer will kick in first, but if a call is placed on hold followed
    by AWOL... */
    this.seintervaltimer = setInterval( () => {
      let opts = {
        "method": "INVITE",
        "body": this.audio.localsdp.toString()
      }

      dialog.request( opts )
        .then( ( res ) => {
          if( 200 != res.msg.status ) {
            this.hangup( hangupcodes.USER_GONE )
          }
        } )
        .catch( () => {
          this.hangup( hangupcodes.USER_GONE )
        } )
    }, singleton.options.seexpire )

    dialog.on( "destroy", ( req ) => {
      if( this.destroyed ) return
      this._onhangup( "wire" )
    } )

    dialog.on( "modify", ( req, res ) => {
      //  The application must respond, using the res parameter provided.
      if( "INVITE" === req.msg.method ) {

        let sdp = sdpgen.create( req.msg.body )
        let media = sdp.getmedia()

        if( ( "inactive" === media.direction || "0.0.0.0" === sdp.sdp.connection.ip ) && !this.held ) {
          this._hold()
          res.send( 200, {
            "headers": {
              "Subject" : "Call on hold",
              "User-Agent": "project",
              "Allow": "INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY",
              "Supported": "replaces"
            },
            "body": this.audio.localsdp.toString()
          } )
        } else if( "inactive" !== media.direction && "0.0.0.0" !== sdp.sdp.connection.ip && this.held ) {
          this._unhold()
          res.send( 200, {
            "headers": {
              "Subject" : "Call off hold",
              "User-Agent": "project"
            },
            "body": this.audio.localsdp.toString()
          } )
        } else {
          /* Unknown - but respond to keep the call going */
          res.send( 200, {
            "headers": {
              "Subject" : "Ok",
              "User-Agent": "project"
            },
            "body": this.audio.localsdp.toString()
          } )
        }
      }
    } )

    dialog.on( "refer", ( req, res ) => {
      /*
        We only support the xfer of 2 legged calls. The xfered call will pick up
        the auth from teh transferee. For example, inbound anonymous call, gets handled
        by user 1. User 1 then refers - to internal extension, so this can has now been
        authed by user 1 - so has access to internal extenions.
      */

      /* First, auth the request */
      let fromparts = parseuri( req.getParsedHeader( "From" ).uri )
      digestauth( {
        "proxy": true, /* 407 or 401 */
        "passwordLookup": ( username, realm, cb ) => {
          singleton.options.userlookup( username, realm )
            .then( ( u ) => {
              cb( false, u.secret )
            } )
            .catch( () => {
              cb( false, false )
            } )
        },
        "realm": fromparts.host
      } )( this.req, this.res, () => {

        if( !req.has( "refer-to" ) ) {
          res.send( 400, "Bad request - no refer-to" )
          return
        }

        let referto = req.getParsedHeader( "refer-to" )
        let parsedrefuri = parseuri( referto.uri )

        if( undefined === parsedrefuri.user ) {
          res.send( 400, "Bad request - no refer-to user" )
          return
        }

        if( undefined === parsedrefuri.host ) {
          res.send( 400, "Bad request - no refer-to host" )
          return
        }

        /*
        Example refer to fields
        Refer-To: sip:alice@atlanta.example.com

        Refer-To: <sip:bob@biloxi.example.net?Accept-Contact=sip:bobsdesk.
               biloxi.example.net&Call-ID%3D55432%40alicepc.atlanta.example.com>

        Refer-To: <sip:dave@denver.example.org?Replaces=12345%40192.168.118.3%3B
                  to-tag%3D12345%3Bfrom-tag%3D5FFE-3994>

        Refer-To: <sip:carol@cleveland.example.org;method=SUBSCRIBE>
        */

        this.referreq = req
        this.referres = res


        /* getParsedHeader doesn't appear to parse tags in uri params */
        let replacesuri = decodeURIComponent( referto.uri )
        let replaces = replacesuri.match( /replaces=(.*?)(;|$)/i )

        if( null !== replaces ) {
          /* Attended xfer */
          consolelog( this, "Attended xfer - swapping channels" )

          let totag = replacesuri.match( /to-tag=(.*?)(;|$)/i )
          let fromtag = replacesuri.match( /from-tag=(.*?)(;|$)/i )

          if( replaces.length < 3 || totag.length < 3 || fromtag.length < 3 ) {
            consolelog( this, "Bad replaces string" )
            res.send( 400, "Bad call reference for replaces" )
            return
          }

          let searchfor = { "callid": replaces[ 1 ], "tags": { "local": totag[ 1 ], "remote": fromtag[ 1 ] } }
          callstore.getbycallid( searchfor )
            .then( ( replacesother ) => {

              let ourother = this.other
              let replacesotherother = replacesother.other
              if( false === replacesotherother ) {
                throw "Can't attened xfer 1 legged calls"
              }
              this.detach()

              /* Swap channels and update */
              let replacesotherotheraudio = replacesotherother.audio
              replacesotherother.audio = this.audio
              replacesotherother.detach()

              replacesotherother.audio.localsdp
                .clearcodecs()
                .addcodecs( replacesotherother.selectedcodec )
                .select( replacesotherother.selectedcodec )
                .setaudiodirection( "sendrecv" )

              if( true === singleton.options.rfc2833 ) {
                replacesotherother.audio.localsdp.addcodecs( "2833" )
              }

              /* this one will be hung up soon anyway */
              this.audio = replacesotherotheraudio

              /* Link logically */

              if( false !== ourother ) {
                /* 2 legged */
                replacesotherother.children.add( ourother )
                ourother.parent = replacesotherother
                replacesotherotheraudio.audio.mix( ourother.audio )
              }

              res.send( 202, "Refering", {}, () => {
                  this._notifyreferstart()
                    .then( () => {

                      /* modify ports and renegotiate codecs */
                      replacesotherother._modifyforxfer()
                        .then( ( o ) => {

                          let remotesdp = sdpgen.create( o )
                          consolelog( this, "remote codec chosen (modify): " + replacesotherother.selectedcodec )
                          replacesotherother.audio.target( remotesdp.select( replacesotherother.selectedcodec ) )

                          /* Now inform our RTP server also - we might need to wait untl the target has completed so need a notify mechanism */
                          replacesotherother.audio.setaudiodirection( "sendrecv" )

                          this._notifyrefercomplete()

                          this.hangup_cause = hangupcodes.ATTENDED_TRANSFER
                          replacesother.hangup( hangupcodes.ATTENDED_TRANSFER )
                        } )
                    } )
                    .catch( () => {
                      this._notifyreferfail()
                    } )
                  } )
          } )
            .catch( ( e ) => {
              consolelog( this, "Failed to find replaces call for xfer" )
              consolelog( this, e )
              res.send( 400, e )
              return
            } )

        } else {
          /* This is our blind xfer */
          consolelog( this, "Blind xfer - sending back to oncall" )
          let othercall = this.other

          if( false === othercall ) {
            res.send( 400, "We have no-one to refer" )
            return
          }

          this.detach()
          res.send( 202 )
          this._notifyreferstart()

          othercall.referingtouri = referto.uri
          singleton.options.em.emit( "call", othercall )
          this._notifyrefercomplete()

          /* As part of the call flow the client will send us a hangup  next */
          this.hangup_cause = hangupcodes.BLIND_TRANSFER
        }
      } )
    } )
  }

  /* TODO suport other types by searching for audio in channels list */
  get audio() {
    if( this.channels.length > 0 ) {
      return this.channels[ 0 ]
    }
    return
  }

  set audio( a ) {
    this.channels[ 0 ] = a
  }

  /* When our dialog has confirmed we have hung up */
  _onhangup( src = "us", reason ) {

    if( this.destroyed ) {
      this._cleanup()
      return
    }

    if( undefined !== reason ) {
      this.hangup_cause = reason
    }

    if( undefined === this.hangup_cause ) {
      this.hangup_cause = hangupcodes.NORMAL_CLEARING
    }

    if( "wire" !== src && !this.established ) {
      this.hangup_cause = hangupcodes.ORIGINATOR_CANCEL
    }

    consolelog( this, "on hangup from " + src + " with reason " + this.hangup_cause.reason + ", SIP: " + this.hangup_cause.sip )

    let wasestablished = this.established

    this.established = false
    this.destroyed = true

    if( undefined !== this.newuactimer ) clearTimeout( this.newuactimer )
    if( undefined !== this.authtimout ) {
      clearTimeout( this.authtimout )
      this.authtimout = false
    }

    this.channels.forEach( ( ch ) => ch.destroy().catch( () => { consolelog( this, "Channel already closed - perhaps RTP stalled?" ) } ) )
    this.channels = []

    callstore.delete( this )

    if( false !== this.parent && true === wasestablished ) {
      this.parent.hangup( this.hangup_cause )
    }

    for( let child of this.children ) {
      child.hangup( this.hangup_cause )
    }

    this._cleanup()
  }

  /* Use this as our destructor. This may get called more than once depending on what is going on */
  _cleanup() {
    /* Clean up promises (ensure they are resolved) and clear any timers */
    if( false !== this.authreject ) {
      this.authreject( this )
    }

    if( false !== this.waitforeventstimer ) {
      clearTimeout( this.waitforeventstimer )
      this.waitforeventstimer = false
    }

    if( false !== this.waitforeventsresolve ) {
      this.waitforeventsresolve( this )
      this.waitforeventsresolve = false
    }

    if( false !== this.newuactimer ) {
      clearTimeout( this.newuactimer )
      this.newuactimer = false
    }

    if( false !== this.newuacreject ) {
      this.newuacreject( this )
      this.newuacreject = false
    }

    if( false !== this.answerreject ) {
      this.answerreject( this )
      this.answerreject = false
    }

    if( false !== this.waitforhangupresolve ) {
      this.waitforhangupresolve( this )
      this.waitforhangupresolve = false
    }

    if( undefined !== this.seintervaltimer ) {
      clearInterval( this.seintervaltimer )
    }
  }

/*
  reason can be:
  undefined = we hangup with NORMAL_CLEARING
  a call object = we take a hangup_cause from the call object and use it (i.e. the hangup_cause is set)
  otherwise it is should be a hangup_cause taken from hangupcodes
*/
  hangup( reason ) {

    if( this.destroyed ) return

    if( undefined === reason ) {
      reason = hangupcodes.NORMAL_CLEARING
    } else if ( typeof reason === "object" ) {
      if( undefined !== reason.hangup_cause ) {
        reason = reason.hangup_cause
      }
    }

    this.hangup_cause = reason

    consolelog( this, "hanging up call by request with the reason " + reason.reason + ", SIP: " + reason.sip )

    if( this.established ) {
      try {
        this.dialog.destroy()
      } catch( e ) { console.error( "Unknown error trying to destroy" ) }

    } else if( "uac" === this.type ) {
      try {
        this.req.cancel()
      } catch( e ) { console.error( "Unknown error trying to cancel" ) }

      this.canceled = true

    } else {
      try {
        this.res.send( reason.sip )
      } catch( e ) { console.error( "Unknown error trying to send" ) }
    }

    this._onhangup( "us", reason )
  }

  waitforhangup() {
    return new Promise( ( resolve, reject ) => {
      this.waitforhangupresolve = resolve
      this.waitforhangupreject = reject

      if( this.destroyed ) {
        this.waitforhangupresolve()
        this.waitforhangupresolve = false
        this.waitforhangupreject = false
      }
    } )
  }
}

module.exports.call = call
module.exports.hangupcodes = hangupcodes
module.exports.setconsolelog = function( c ) { consolelog = c }
module.exports.setcallmanager = function( cm ) { singleton = cm }
