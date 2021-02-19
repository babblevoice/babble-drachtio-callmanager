
const { v4: uuidv4 } = require( "uuid" )

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
  NO_ANSWER: { "reason": "NO_ANSWER", "sip": 480 }, /* Temporarily Unavailable */
  LOOP_DETECTED: { "reason": "LOOP_DETECTED", "sip": 482 },
  INVALID_NUMBER_FORMAT: { "reason": "INVALID_NUMBER_FORMAT", "sip": 484 },
  USER_BUSY: { "reason": "USER_BUSY", "sip": 486 },
  NORMAL_CLEARING: { "reason": "NORMAL_CLEARING", "sip": 487 },
  REQUEST_TERMINATED: { "reason": "REQUEST_TERMINATED", "sip": 487 },
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
    this.sdp = {}

    /* an array of channels */
    this.channels = []

    /* UACs we create */
    this.children = []
    this.parent = false

    if( undefined !== req ) {

      this.source_address = req.source_address
      this.source_port = req.source_port
      this.source_protocol = req.protocol

      this.sip = {}
      this.sip.callid = req.msg.headers[ "call-id" ]

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

  set ringing( s ) {
    if( this.state.ringing != s ) {
      this.state.ringing = s
    }
  }

  set established( s ) {
    if( this.state.established != s ) {
      this.answerat = Math.floor( +new Date() / 1000 )
      this.state.established = s
    }
  }

  set canceled( s ) {
    if( this.state.canceled != s ) {
      this.endat = Math.floor( +new Date() / 1000 )
      this.state.canceled = s
    }
  }

  set destroyed( s ) {
    if( this.state.destroyed != s ) {
      this.endat = Math.floor( +new Date() / 1000 )
      this.state.destroyed = s
    }
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

  newuac( contact, from ) {

    return new Promise( ( resolve, reject ) => {

      let newcall = new call()
      newcall.type = "uac"
      newcall.parent = this
      newcall.newuacresolve = resolve
      newcall.newuacreject = reject
      newcall.direction = "recipient"

      this.children.push( newcall )

      newcall.newuactimer = setTimeout( () => {
        consolelog( newcall, "UAC timer fired" )
        newcall.hangup( hangupcodes.NO_USER_RESPONSE )

      }, singleton.options.uactimeout )

      singleton.options.srf.createUAC( contact, {
          headers: {
            "From": from
          },
          noAck: true
        },
        {
          cbRequest: ( err, req ) => {
            newcall.req = req
            newcall.trying = true

            newcall.sip = {}
            newcall.sip.callid = req.msg.headers[ "call-id" ]
          },
          cbProvisional: ( res ) => {
            newcall.res = res
            if( 180 === res.status ) {
              newcall._onring()
            }

            if( true === newcall.canceled ) {
              newcall.hangup()
            }
          }
        } )
        .then( ( dlg ) => {
          newcall.dialog = dlg
          newcall.sdp.remote = sdpgen.create( dlg.sdp )
          newcall.established = true
          newcall._onanswer()
        } )
        .catch( ( err ) => {

          if ( undefined !== err.status ) {
            let reason = hangupcodes.REQUEST_TERMINATED
            if( 486 === err.status ) {
              reason = hangupcodes.USER_BUSY
            }

            newcall._onhangup( "wire", reason )
          } else {
            consolelog( this, err )
          }
        } )

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
        this.parent.children.forEach( ( child ) => {
          if( child.uuid !== this.uuid ) {
            child.hangup()
          }
        } )
      }
      this.parent.children = [ this ]
    }

    clearTimeout( this.newuactimer )
    this.newuactimer = false

    /* We now have 2 calls, we may need to answer the parent */
    /* We have this.dialog (srf dialog object) and this.sdp.remote (sdp object) */
    if( this.parent.established ) {
      this.selectedcodec = this.sdp.remote.intersection( singleton.options.preferedcodecs, true )
      consolelog( this, "remote codec chosen: " + this.selectedcodec )

      singleton.rtp.channel( this.sdp.remote.select( this.selectedcodec ) )
        .then( ch => {
          this.channels.push( ch )
          ch.on( "telephone-event", ( e ) => this._tevent( e ) )

          this.sdp.local = sdpgen.create().addcodecs( this.selectedcodec ).setchannel( ch )
          if( true === singleton.options.rfc2833 ) {
            this.sdp.local.addcodecs( "2833" )
          }

          this.dialog.ack( this.sdp.local.toString() )
            .then( ( dlg ) => {
              this.dialog = dlg
              this.addevents( this.dialog )
              this.audio.mix( this.parent.audio )
              this.newuacresolve( this )

              if( false !== this.newuactimer ) clearTimeout( this.newuactimer )

              this.newuactimer = false
              this.newuacresolve = false
              this.newuacreject = false
            } )

          if( this.canceled ) {
            if( false !== this.newuacreject ) this.newuacreject( this )
            if( false !== this.newuactimer ) clearTimeout( this.newuactimer )

            this.newuactimer = false
            this.newuacresolve = false
            this.newuacreject = false
            return
          }
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
        let remotecodecs = this.sdp.remote.intersection( singleton.options.preferedcodecs )
        consolelog( this, "remote codecs (late negotiation) chosen: " + remotecodecs )

        this.parent.answer( { "preferedcodecs": remotecodecs } )
          .then( () => {

            this.selectedcodec = this.parent.selectedcodec

            this.sdp.local = sdpgen.create().addcodecs( this.selectedcodec )
            singleton.rtp.channel( this.sdp.local )
              .then( ch => {
                this.sdp.local.setchannel( ch )
                this.channels.push( ch )
                ch.on( "telephone-event", ( e ) => this._tevent( e ) )

                if( true === singleton.options.rfc2833 ) {
                  this.sdp.local.addcodecs( "2833" )
                }

                this.dialog.ack( this.sdp.local.toString() )
                  .then( ( dlg ) => {
                    this.dialog = dlg
                    this.addevents( this.dialog )
                    this.audio.mix( this.parent.audio )
                    this.newuacresolve( this )

                    if( false !== this.newuactimer ) clearTimeout( this.newuactimer )

                    this.newuactimer = false
                    this.newuacresolve = false
                    this.newuacreject = false
                  } )
                  .catch( () => {
                    if( false !== this.newuacreject ) this.newuacreject( this )
                    if( false !== this.newuactimer ) clearTimeout( this.newuactimer )

                    this.newuactimer = false
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
    return parseuri( this.req.msg.uri )
  }

  /*
    auth - returns promise.
  */
  auth() {
    return new Promise( ( resolve, reject ) => {
      this.authresolve = resolve
      this.authreject = reject
      this.authtimout = setTimeout( () => {
        this.authreject()
        this.authresolve = false
        this.authreject = false
        this.authtimout = false

        this.hangup( hangupcodes.NO_USER_RESPONSE )

      }, 50000 )

      let toparts = parseuri( this.req.getParsedHeader( "To" ).uri )

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
        "realm": toparts.host
      } )( this.req, this.res, () => {} )
    } )
  }

  /* Private - called by us we handle the auth challenge in this function */
  _onauth( req, res ) {

    this.req = req
    this.res = res

    this.req.on( "cancel", () => this._oncanceled() )

    /* are we waiting for an auth ?*/
    if( undefined !== this.authresolve ) {
      consolelog( this, "checking auth" )

      let toparts = parseuri( req.getParsedHeader( "To" ).uri )

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
        "realm": toparts.host
      } )( this.req, this.res, () => {
        consolelog( this, "resolving auth" )
        if( false !== this.authtimout ) {
          clearTimeout( this.authtimout )
          this.authtimout = false
        }

        this.entity = this.req.authorization.username + "@" + this.req.authorization.realm
        callstore.set( this )

        this.authresolve()
        this.authresolve = false
        this.authreject = false
        this.authtimout = false

        callstore.getbyentity()
          .then( ( s ) => {
            singleton.options.em.emit( "presence.dialog.out", {
              "entity": this.entity,
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

    this.children.forEach( ( child ) => {
      child.hangup()
    } )
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
      this.res.send( 180 )
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

      this.answerresolve = resolve
      this.answerreject = reject

      if( this.canceled ) {
        this.answerreject()
        return
      }

      options = { ...singleton.options, ...this.options, ...options }

      this.sdp.remote = sdpgen.create( this.req.msg.body )

      /* options.preferedcodecs may have been narrowed down so we still check singleton as well */
      this.selectedcodec = this.sdp.remote.intersection( options.preferedcodecs, true )
      if( false === this.selectedcodec ) {
        this.selectedcodec = this.sdp.remote.intersection( singleton.options.preferedcodecs, true )
      }

      consolelog( this, "answer call with codec " + this.selectedcodec )

      singleton.rtp.channel( this.sdp.remote.select( this.selectedcodec ) )
        .then( ch => {
          consolelog( this, "channel opened" )

          this.channels.push( ch )
          this.sdp.local = sdpgen.create().addcodecs( this.selectedcodec ).setchannel( ch )
          ch.on( "telephone-event", ( e ) => this._tevent( e ) )

          if( this.canceled ) {
            this.answerreject()

            this.answerresolve = false
            this.answerreject = false
            return
          }

          if( true === singleton.options.rfc2833 ) {
            this.sdp.local.addcodecs( "2833" )
            ch.rfc2833( 101 )
          }

          singleton.options.srf.createUAS( this.req, this.res, {
            localSdp: this.sdp.local.toString()
          } )
          .then( ( dialog ) => {
            this.established = true
            this.dialog = dialog
            this.addevents( this.dialog )
            this.answerresolve()

            this.answerresolve = false
            this.answerreject = false

            this.addevents( this.dialog )
          } )
          .catch( ( err ) => { this.answerreject() } )
        } ).catch( ( err ) => {
          this.answerreject()

          this.answerresolve = false
          this.answerreject = false
        } )
    } )
  }

  _hold() {

    consolelog( this, "Placing call on hold" )
    if( this.held ) return
    this.held = true

    this.audio.unmix( this.audio )

    let other
    if( false !== this.parent ) {
      other = this.parent
    } else {
      if( 0 === this.children.length ) return
      other = this.children[ 0 ]
    }

    other.audio.play( singleton.options.moh )
  }

  _unhold() {
    consolelog( this, "Call off hold" )
    if( !this.held ) return
    this.held = false

    let other
    if( false !== this.parent ) {
      other = this.parent
    } else {
      if( 0 === this.children.length ) return
      other = this.children[ 0 ]
    }

    this.audio.mix( other.audio )

  }

  addevents( dialog ) {
    dialog.on( "destroy", ( req ) => {
      if( this.destroyed ) return
      this._onhangup( "wire" )
    } )

    dialog.on( "hold", ( req ) => {
      this._hold()
    } )

    dialog.on( "unhold", ( req ) => {
      this._unhold()
    } )

    dialog.on( "refer", ( req, res ) => {
      consolelog( this, "refer" )
    } )

    dialog.on( "modify", ( req, res ) => {
      //  The application must respond, using the res parameter provided.
      if( "INVITE" === req.msg.method ) {

        let sdp = sdpgen.create( req.msg.body )
        let media = sdp.getmedia()

        if( ( "inactive" === media.direction || "0.0.0.0" === sdp.sdp.connection.ip ) && !this.held ) {
          this._hold()
        } else if( "inactive" !== media.direction && "0.0.0.0" !== sdp.sdp.connection.ip && this.held ) {
          this._unhold()
        }

        res.send( 200 )
      }

      consolelog( this, "modify" )

    } )
  }

  /* TODO suport other types by searching for audio in channels list */
  get audio() {
    if( this.channels.length > 0 ) {
      return this.channels[ 0 ]
    }
    return
  }

  /* When our dialog has confirmed we have hung up */
  _onhangup( src = "us", reason ) {

    if( this.destroyed ) {
      this._cleanup()
      return
    }

    consolelog( this, "on hangup from " + src )
    this.hangup_cause = reason

    let wasestablished = this.established

    this.established = false
    this.destroyed = true

    if( undefined !== this.newuactimer ) clearTimeout( this.newuactimer )
    if( undefined !== this.authtimout ) {
      clearTimeout( this.authtimout )
      this.authtimout = false
    }

    this.channels.forEach( ( ch ) => ch.destroy().catch( () => { consolelog( "Channel already closed - perhaps RTP stalled?" ) } ) )
    this.channels = []

    callstore.delete( this )

    if( false !== this.parent && true === wasestablished ) {
      this.parent.hangup( reason )
    }

    this.children.forEach( ( child ) => {
      child.hangup( reason )
    } )

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

  /*
  destination can be
  1000
  1000@bling.babblevoice.com
  sip:1000@bling.babblevoice.com
  */
  parsedestination( destination ) {
    if( "sip:" !== destination.substring( 0, 4 ) ) {
      destination = "sip:" + destination
    }

    if( -1 === str.indexOf( "@" ) ) {
      destination = destination + "@" + this.req.authorization.realm
    }
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
