
const { v4: uuidv4 } = require( "uuid" )
const events = require( "events" )

const url = require( "url" )
const querystring = require( "querystring" )

const projectrtp = require( "projectrtp" ).projectrtp

const parseuri = require( "drachtio-srf" ).parseUri
const sdpgen = require( "./sdp.js" )
const callstore = require( "./store.js" )

const sipauth = require( "babble-drachtio-auth" )

/*
Enum for different reasons for hangup.
*/
const hangupcodes = {
  /* Client error responses */
  PAYMENT_REQUIRED: { "reason": "PAYMENT_REQUIRED", "sip": 402 },
  FORBIDDEN: { "reason": "FORBIDDEN", "sip": 403 },
  OUTGOING_CALL_BARRED: { "reason": "OUTGOING_CALL_BARRED", "sip": 403 },
  INCOMING_CALL_BARRED: { "reason": "INCOMING_CALL_BARRED", "sip": 403 },
  UNALLOCATED_NUMBER: { "reason": "UNALLOCATED_NUMBER", "sip": 404 },
  NOT_ALLOWED: { "reason": "NOT_ALLOWED", "sip": 405 },
  NOT_ACCEPTABLE: { "reason": "NOT_ACCEPTABLE", "sip": 406 },
  PROXY_AUTHENTICATION: { "reason": "PROXY_AUTHENTICATION", "sip": 407 },
  REQUEST_TIMEOUT: { "reason": "REQUEST_TIMEOUT", "sip": 408 },
  USER_GONE: { "reason": "USER_GONE", "sip": 410 },
  TEMPORARILY_UNAVAILABLE: { "reason": "TEMPORARILY_UNAVAILABLE", "sip": 480 },
  CALL_DOES_NOT_EXIST: { "reason": "CALL_DOES_NOT_EXIST", "sip": 481 },
  LOOP_DETECTED: { "reason": "LOOP_DETECTED", "sip": 482 },
  TOO_MANY_HOPS: { "reason": "TOO_MANY_HOPS", "sip": 483 },
  INVALID_NUMBER_FORMAT: { "reason": "INVALID_NUMBER_FORMAT", "sip": 484 },
  AMBIGUOUS: { "reason": "AMBIGUOUS", "sip": 485 },
  USER_BUSY: { "reason": "USER_BUSY", "sip": 486 },
  NORMAL_CLEARING: { "reason": "NORMAL_CLEARING", "sip": 487 },
  ORIGINATOR_CANCEL: { "reason": "ORIGINATOR_CANCEL", "sip": 487 },
  USER_NOT_REGISTERED: { "reason": "USER_NOT_REGISTERED", "sip": 487 },
  BLIND_TRANSFER: { "reason": "BLIND_TRANSFER", "sip": 487 },
  ATTENDED_TRANSFER: { "reason": "ATTENDED_TRANSFER", "sip": 487 },
  LOSE_RACE: { "reason": "LOSE_RACE", "sip": 487 },
  PICKED_OFF: { "reason": "PICKED_OFF", "sip": 487 },
  MANAGER_REQUEST: { "reason": "MANAGER_REQUEST", "sip": 487 },
  REQUEST_TERMINATED: { "reason": "REQUEST_TERMINATED", "sip": 487 },
  INCOMPATIBLE_DESTINATION: { "reason": "INCOMPATIBLE_DESTINATION", "sip": 488 },
  /* Server error responses */
  SERVER_ERROR: { "reason": "SERVER_ERROR", "sip": 500 },
  FACILITY_REJECTED: { "reason": "FACILITY_REJECTED", "sip": 501 },
  DESTINATION_OUT_OF_ORDER: { "reason": "DESTINATION_OUT_OF_ORDER", "sip": 502 },
  SERVICE_UNAVAILABLE: { "reason": "SERVICE_UNAVAILABLE", "sip": 503 },
  SERVER_TIMEOUT: { "reason": "SERVER_TIMEOUT", "sip": 504 },
  MESSAGE_TOO_LARGE: { "reason": "MESSAGE_TOO_LARGE", "sip": 513 },
  /* Global error responses */
  BUSY_EVERYWHERE: { "reason": "BUSY_EVERYWHERE", "sip": 600 },
  DECLINED: { "reason": "DECLINED", "sip": 603 },
  DOES_NOT_EXIST_ANYWHERE: { "reason": "DOES_NOT_EXIST_ANYWHERE", "sip": 604 },
  UNWANTED: { "reason": "UNWANTED", "sip": 607 },
  REJECTED: { "reason": "REJECTED", "sip": 608 }
}

/* Reverse codes - include inbound error codes.
If not in this list we return REQUEST_TERMINATED during creation */
const inboundsiperros = {
  486: hangupcodes.USER_BUSY,
  408: hangupcodes.REQUEST_TIMEOUT,
  404: hangupcodes.UNALLOCATED_NUMBER
}

var callmanager

/** @class */
class call {

/**
Construct our call object with all defaults, including a default UUID.
@constructs call
@hideconstructor
@param {object} [req] - the req object passed into us from Drachtio
@param {object} [res] - the res object passed into us from Drachtio
*/
  constructor( req, res ) {
    this.uuid = uuidv4()

    /**
    @enum {string} type "uas" | "uac"
    @summary The type (uac or uas) from our perspective.
    */
    this.type = "uac"

    /**
      @typedef {Object} callstate
      @property {boolean} trying
      @property {boolean} ringing
      @property {boolean} established
      @property {boolean} canceled
      @property {boolean} destroyed
      @property {boolean} held
    */

    /** @member {callstate} */
    this.state = {
      "trying": false,
      "ringing": false,
      "established": false,
      "canceled": false,
      "destroyed": false,
      "held": false,
      "authed": false,
      "cleaned": false,
      "refered": false
    }

    /**
    @member
    @summary Channels which have been created
    */
    this.channels = {
      "audio": false
    }

    /**
    @member
    @summary Store our local and remote sdp objects
    */
    this.sdp = {
      "local": false,
      "remote": false
    }

    /**
    @member
    @summary UACs we create
    */
    this.children = new Set()
    /**
    @member
    @summary Who created us
    */
    this.parent = false

    /**
      @typedef {Object} epochs
      @property {number} startat UNIX timestamp of when the call was started (created)
      @property {number} answerat UNIX timestamp of when the call was answered
      @property {number} endat UNIX timestamp of when the call ended
    */

    /** @member {epochs} */
    this.epochs = {
      "startat": Math.floor( +new Date() / 1000 ),
      "answerat": 0,
      "endat": 0
    }

    /**
      @typedef {Object} sipdialog
      @property {string} callid
      @property {object} tags
      @property {string} tags.local
      @property {string} tags.remote
    */
    /** @member {sipdialog} */
    this.sip = {
      "callid": "",
      "tags": {
        "remote": "",
        "local": ""
      }
    }

    /**
      @typedef {Object} entity
      @property {string} [username] username part
      @property {string} [realm] realm (domain) part
      @property {string} [uri] full uri
      @property {string} [display] how the user should be displayed
    */
    /**
    @member {entity}
    */
    this.entity = {}

    /**
    @member {object}
    @summary user definable object that allows other modules to store data in this call.
    */
    this.vars = {}

    /**
    @member {string}
    @private
    */
    this._receivedtelevents = ""

    /**
    @member {object}
    @private
    */
    this._promises = {
      "resolve": {
        "auth": false,
        "hangup": false,
        "events": false
      },
      "reject": {
        "auth": false
      },
      "promise": {
        "hangup": false,
        "events": false
      }
    }

    /**
    @member {object}
    @private
    */
    this._timers = {
      "auth": false,
      "newuac": false,
      "events": false,
      "seinterval": false
    }

    /**
    @member {object}
    @private
    */
    this._em = new events.EventEmitter()


    if( undefined !== req ) {
      /* We have received the INVITE */
      this.type = "uas"

      /**
        @typedef {Object} source
        @property {string} address
        @property {number} port
        @property {string} protocol
      */

      /** @member {source} */
      this.source = {
        "address": req.source_address,
        "port": req.source_port,
        "protocol": req.protocol
      }

      this.sip.callid = req.getParsedHeader( "call-id" )
      this.sip.tags.remote = req.getParsedHeader( "from" ).params.tag

      /**
      @member
      @private
      */
      this._req = req
      this._req.on( "cancel", () => this._oncanceled() )
      /**
      @member
      @private
      */
      this._res = res
    }

    /**
    @member
    @private
    */
    this._auth = new sipauth.auth()

    callstore.set( this )
    callmanager.options.em.emit( "call.new", this )
  }

  /*
  State functions
  Get state as a string
  According to state machine in RFC 4235, we send early if we have received a 1xx with tag
  I am going to use 100 and 180 - which should be the same.
  */

  /**
    hasmedia
    @return {bool} - true if the call has media (i.e. is established on not held).
  */
  get hasmedia() {
    if( this.state.held ) return false
    return true == this.state.established
  }

  /**
    trying
    @return {bool} - true if the call has been trying.
  */
  set trying( s ) {
    if( this.state.trying != s ) {
      this.state.trying = s
    }
  }

  /**
    trying
    @return {bool} - true if the call has been trying.
  */
  get trying() {
    return this.state.trying
  }

  /**
    ringing
    @return {bool} - true if the call has been ringing.
  */
  get ringing() {
    return this.state.ringing
  }

  /**
    established - if the call isn't already established then set the answerat time.
    @param {bool} s - true if the call has been established.
  */
  set established( s ) {
    if( this.state.established != s ) {
      this.epochs.answerat = Math.floor( +new Date() / 1000 )
      this.state.established = s
    }
  }

  /**
    established
    @return {bool} - true if the call has been established.
  */
  get established() {
    return this.state.established
  }

  /**
    @summary canceled - if the call isn't already canceled then set the endat time.
    @type {boolean}
  */
  set canceled( s ) {
    if( this.state.canceled != s ) {
      this.epochs.endat = Math.floor( +new Date() / 1000 )
      this.state.canceled = s
    }
  }

  /**
    @summary is the call canceled
    @return {boolean} - true if the call has been canceled.
  */
  get canceled() {
    return true == this.state.canceled
  }

  /**
    destroyed - if the call isn't already desroyed then set the endat time.
    @param {bool} s - true if the call has been destroyed.
  */
  set destroyed( s ) {
    if( this.state.destroyed != s ) {
      this.epochs.endat = Math.floor( +new Date() / 1000 )
      this.state.destroyed = s
    }
  }

  /**
    destroyed
    @return {bool} - true if teh call has been destroyed.
  */
  get destroyed() {
    return true == this.state.destroyed
  }

  /**
    @summary the current state of the call as a string: trying|proceeding|early|confirmed|terminated
    @return {string}
  */
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

  /**
    duration
    @return {number} - the number of seconds between now (or endat if ended) and the time the call was started.
  */
  get duration() {
    if( 0 !== this.epochs.endat ) return parseInt( this.epochs.endat - this.epochs.startat )
    return parseInt( Math.floor( +new Date() / 1000 ) - this.epochs.startat )
  }

  /**
    Get the estrablished time.
    @return {number} - the number of seconds between now (or endat if ended) and the time the call was answered.
  */
  get billingduration() {
    if( 0 === this.epochs.answerat ) return 0
    if( 0 !== this.epochs.endat ) return parseInt( this.epochs.endat - this.epochs.answerat )
    return parseInt( Math.floor( +new Date() / 1000 ) - this.epochs.answerat )
  }

  /**
    Callback for events we pass back to inerested parties.
    @callback call.event
    @param {object} call - we pass *this back into the requester
  */

  /**
    Registers an event callback for this specific call. An event sink registered
    on this member will receive events only for this call. We emit on call specific
    emitter and a global emitter.
    @memberof call
    @param {string} ev - The contact string for registered or other sip contact
    @param {call.event} cb
  */
  on( ev, cb ) {
    this._em.on( ev, cb )
  }

  /**
  Call creation event.
  @event call.new
  @type {call}
  */

  /**
  Emitted when a call is ringing
  @event call.ringing
  @type {call}
  */

  /**
  Emitted when a call is answered
  @event call.answered
  @type {call}
  */

  /**
  Emitted when a call is authed
  @event call.authed
  @type {call}
  */

  /**
  Emitted when a call auth fails
  @event call.authed.failed
  @type {call}
  */

  /**
  Emitted when a call is placed on hold
  @event call.hold
  @type {call}
  */

  /**
  Emitted when a call is taken off hold
  @event call.unhold
  @type {call}
  */

  /**
  Emitted when a call is destroyed
  @event call.destroyed
  @type {call}
  */

  /**
    Delink calls logically - any calls which have parent or children they are all removed.
    when the dialog is either answered (or doesn't answer for some reason).
    The promise resolves to a new call is one is generated, or undefined if not.
  */
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

  /**
    @summary Creates a new SIP dialog. Returns a promise which resolves
    when the dialog is either answered (or cancelled for some reason).
    The promise resolves to a new call is one is generated, or undefined if not.
    @param {string} contact - The contact string for registered or other sip contact
    @param {Object} [options] - Options object. See default_options in index.js for more details.
    @param {string} [options.auth.username] - If SIP auth required username
    @param {string} [options.auth.password] - If SIP auth required password
    @param {object} [options.headers] - Object containing extra sip headers required.
    @param {object} [options.uactimeout] - override the deault timeout
    @param {boolean} [options.late] - late negotiation
    @return {Promise} - returns a promise which resolves to a new call object if a dialog has been confirmed (or failed).
  */
  async newuac( contact, options ) {

    let newcall = new call()
    newcall.type = "uac"
    newcall.parent = this

    this.children.add( newcall )

    newcall.options = {
        headers: {
        }
      }

    newcall.options = { ...callmanager.options, ...newcall.options, ...options }

    newcall._timers.newuac = setTimeout( () => {
      newcall.hangup( hangupcodes.REQUEST_TIMEOUT )
    }, newcall.options.uactimeout )

    if( undefined !== newcall.options.late && true === newcall.options.late ) {
      newcall.options.noAck = true /* this is a MUST for late negotiation */
    } else {
      newcall.channels.audio = await projectrtp.openchannel( this._handlechannelevents.bind( this ) )

      newcall.sdp.local = sdpgen.create().addcodecs( newcall.options.preferedcodecs )
      newcall.sdp.local.setaudioport( newcall.channels.audio.local.port )
        .setconnectionaddress( newcall.channels.audio.local.address )

      /* Create our SDP */
      newcall.options.localSdp = newcall.sdp.local.toString()
    }

    newcall._dialog = await callmanager.options.srf.createUAC( contact, newcall.options, {
      cbRequest: ( err, req ) => {
        newcall._req = req
        newcall.state.trying = true

        newcall.sip = {
          "callid": req.getParsedHeader( "call-id" ),
          "tags": {
            "local": req.getParsedHeader( "from" ).params.tag,
            "remote": ""
          }
        }
        callstore.set( newcall )
      },
      cbProvisional: ( res ) => {
        newcall._res = res
        if( 180 === res.status ) {
          newcall._onring()
        }

        if( newcall.canceled ) {
          newcall.hangup()
        }
      }
    } ).catch( ( err ) => {
      if ( undefined !== err.status ) {
        let reason = hangupcodes.REQUEST_TERMINATED
        if( err.status in inboundsiperros ) reason = inboundsiperros[ err.status ]

        if( newcall ) newcall._onhangup( "wire", reason )
      } else {
        console.error( err )
      }

      return newcall
    } )

    if( newcall.state.destroyed ) return newcall

    newcall.sdp.remote = sdpgen.create( newcall._dialog.remote.sdp )
    return await newcall._onanswer()
  }

  /**
    Called from newuac when we receive a 180
    @private
  */
  _onring() {
    this.ringing = true
    if( false !== this.parent ) {
      this.parent.ring()
    }

    this._em.emit( "call.ringing", this )
    callmanager.options.em.emit( "call.ringing", this )
  }

  /**
    Called from newuac when we are answered and we have a dialog,
    this = child call (the new call - the bleg)
    @private
  */
  async _onanswer() {

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

    if( this._timers.newuac ) clearTimeout( this._timers.newuac )
    this._timers.newuac = false

    if( true === this.options.noAck ) {
      await this._onlatebridge()
    } else {
      await this._onearlybridge()
    }

    this.established = true
    this.sip.tags.remote = this._dialog.sip.remoteTag
    callstore.set( this )

    if( this._timers.newuac ) clearTimeout( this._timers.newuac )
    this._timers.newuac = false

    let r = this._promises.resolve.newuac
    this._promises.resolve.newuac = false
    this._promises.reject.newuac = false

    if( r ) r( this )
    return this
  }

  /**
    On an early negotiation we have already sent our sdp without
    knowing what the otherside is going to offer. We now have the
    other sides SDP so we can work out the first common CODEC.
    this = child call (the new call - the bleg)
    @private
  */
  async _onearlybridge() {
    if( this.destroyed ) return

    this._addevents( this._dialog )

    this.sdp.remote = sdpgen.create( this._dialog.remote.sdp )
    this.selectedcodec = this.sdp.remote.intersection( this.options.preferedcodecs, true )
    if( "" == this.selectedcodec ) {
      return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )
    }

    let target = this.sdp.remote.getaudio()
    if( !target ) return

    this.channels.audio.target( call._createchanneltargetdef( target.address, target.port, target.audio.payloads[ 0 ] ) )

    if( !this.parent.established ) {
      await this.parent.answer( { "preferedcodecs": this.selectedcodec } )
        .catch( ( err ) => {
          console.error( err )
        } )

      if( !this.parent.established ) {
        return this.hangup( hangupcodes.USER_GONE )
      }
    }

    this.channels.audio.mix( this.parent.channels.audio )

    return this
  }

  /**
    Accept and bridge to calls with late negotiation.
    this = child call (the new call - the bleg)
    @private
  */
  async _onlatebridge() {

    /* Calcualte the best codec for both legs - find a common codec if possible
    if not - transcode */
    let alegremotesdp
    if( this.parent.established ) {
      alegremotesdp = this.parent.sdp.remote
    } else {
      alegremotesdp = sdpgen.create( this.parent._req.msg.body )
    }

    this.sdp.remote = sdpgen.create( this._req.msg.body )
    this.parent.selectedcodec = this.selectedcodec = this.sdp.remote.intersection(
                                                        alegremotesdp.intersection( this.options.preferedcodecs ), true )

    if( "" == this.selectedcodec ) {
      /* Ok - transcode */
      this.selectedcodec = this.sdp.remote.intersection( this.options.preferedcodecs, true )
      this.parent.selectedcodec = this.options.preferedcodecs
      if( "" == this.selectedcodec || "" == this.parent.selectedcodec ) {
        return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )
      }
    }

    let target = this.sdp.remote.getaudio()
    if( !target ) return
    let channeldef = {
      "target": {
        "address": target.address,
        "port": target.port,
        "codec": target.audio.payloads[ 0 ]
        /*
        dtls:{
          fingerprint: "",
          setup: ""
        }
        */
      }
    }

    this.channels.audio = await projectrtp.openchannel( channeldef, this._handlechannelevents.bind( this ) )

    this.sdp.local = sdpgen.create()
              .addcodecs( this.selectedcodec )
              .setconnectionaddress( this.channels.audio.local.address )
              .setaudioport( this.channels.audio.local.port )

    if( true === this.options.rfc2833 ) {
      this.sdp.local.addcodecs( "2833" )
    }

    this._dialog = await this._dialog.ack( this.sdp.local.toString() )
    this._addevents( this._dialog )

    if( !this.parent.established ) {
      await this.parent.answer( { "preferedcodecs": this.selectedcodec } )
        .catch( ( err ) => {
          console.error( err )
        } )

      if( !this.parent.established ) {
        return this.hangup( hangupcodes.USER_GONE )
      }
    }

    this.channels.audio.mix( this.parent.channels.audio )

    return this
  }

  /**
    Return the destination of the call.
    @return {object}  parsed uri
  */
  get destination() {
    if( undefined !== this.referingtouri ) {
      return parseuri( this.referingtouri )
    }
    return parseuri( this._req.msg.uri )
  }

  /**
    Sometimes we don't care who if we are the parent or child - we just want the other party
    @return {object|bool} returns call object or if none false
  */
  get other() {
    if( this.parent ) return this.parent

    for( const child of this.children ) {
      if( child.established ) {
        return child
      }
    }

    return false
  }

  /**
    auth - returns promise. This will force a call to be authed by a client. If the call
    has been refered by another client that has been authed this call will assume that auth.
    @todo check refering call has been authed
    @return {Promise} Returns promise which resolves on success or rejects on failed auth. If not caught this framework will catch and cleanup.
  */
  auth() {
    return new Promise( ( resolve, reject ) => {

      if( undefined !== this.referingtouri ) {
        /* if we have been refered the call has been authed to proceed by the refering party */
        resolve()
        return
      }

      this._promises.resolve.auth = resolve
      this._promises.reject.auth = reject

      this._timers.auth = setTimeout( () => {
        this._promises.reject.auth()
        this._promises.resolve.auth = false
        this._promises.reject.auth = false
        this._timers.auth = false

        this.hangup( hangupcodes.REQUEST_TIMEOUT )

      }, 50000 )

      if( !this._auth.requestauth( this._req, this._res ) ) return this.hangup( hangupcodes.FORBIDDEN )
    } )
  }

  /**
    Called by us we handle the auth challenge in this function
    @private
  */
  async _onauth( req, res ) {

    /* have we got an auth responce */
    if( !this._auth.has( req ) ) return

    this._req = req
    this._res = res

    this._req.on( "cancel", () => this._oncanceled() )

    let authorization = this._auth.parseauthheaders( this._req, this._res )
    let user = await callmanager.options.userlookup( authorization.username, authorization.realm )

    if( !user || !this._auth.verifyauth( this._req, authorization, user.secret ) ) {

      if( this._auth.stale ) {
        return this._auth.requestauth( this._req, this._res )
      }

      this.hangup( hangupcodes.FORBIDDEN )

      let r = this._promises.reject.auth
      this._promises.resolve.auth = false
      this._promises.reject.auth = false
      this._timers.auth = false
      if( r ) r()

      this._em.emit( "call.authed.failed", this )
      callmanager.options.em.emit( "call.authed.failed", this )

      return
    }

    if( this.destroyed ) return

    if( this._timers.auth ) clearTimeout( this._timers.auth )
    this._timers.auth = false

    this.entity.username = authorization.username
    this.entity.realm = authorization.realm
    this.entity.uri = authorization.username + "@" + authorization.realm

    this.state.authed = true

    callstore.set( this )

    let r = this._promises.resolve.auth
    this._promises.resolve.auth = false
    this._promises.reject.auth = false
    this._timers.auth = false
    if( r ) r()

    this._em.emit( "call.authed", this )
    callmanager.options.em.emit( "call.authed", this )

  }

  /**
    Called by us to handle call cancelled
    @private
  */
  _oncanceled( req, res ) {
    this.canceled = true

    for( let child of this.children ) {
      child.hangup()
    }
  }

  /**
    Called by us to handle DTMF events. If it finds a match it resolves the Promise created by waitforevents.
    @private
  */
  _tevent( e ) {
    this._receivedtelevents += e

    if( undefined !== this.eventmatch ) {
      let ourmatch = this._receivedtelevents.match( this.eventmatch )
      if( null !== ourmatch ) {

        if( this._promises.resolve.events ) {
          this._promises.resolve.events( ourmatch[ 0 ] )
          this._promises.resolve.events = false
          this._promises.promise.events = false
        }

        if( this._timers.events ) {
          clearTimeout( this._timers.events )
          this._timers.events = false
        }
      }
    }
  }

  /**
    Called by our call plan to wait for events for auto attendant/IVR.
    @param {string} [match] - reg exp matching what is required from the user.
    @param {Int} [timeout] - time to wait before giving up.
    @return {Promise} - the promise either resolves to a string if it matches or undefined if it times out..
  */
  waitforevents( match = /[0-9A-D\*#]/, timeout = 30000 ) {

    if( this._promises.promise.events ) return this._promises.promise.events

    this._promises.promise.events = new Promise( ( resolve ) => {

      this._timers.events = setTimeout( () => {

        if( this._promises.resolve.events ) {
          this._promises.resolve.events()
        }

        this._promises.resolve.events = false
        this._promises.promise.events = false
        this._timers.events = false

      }, timeout )

      if( typeof match === "string" ){
        this.eventmatch = new RegExp( match )
      } else {
        this.eventmatch = match
      }

      this._promises.resolve.events = resolve

      /* if we have something already in our buffer */
      this._tevent( "" )
    } )

    return this._promises.promise.events
  }

  /**
    Clear our current buffer to ensure new input
  */
  clearevents() {
    this._receivedtelevents = ""
  }

  /**
    If we are not ringing - send ringing to the other end.
  */
  ring() {
    if( !this.ringing && "uas" === this.type ) {
      this.state.ringing = true
      this._res.send( 180, {
        headers: {
           "User-Agent": "project",
           "Supported": "replaces"
         }
      } )

      this._em.emit( "call.ringing", this )
      callmanager.options.em.emit( "call.ringing", this )
    }
  }

  /**
    Shortcut to hangup with the reason busy.
  */
  busy() {
    this.hangup( hangupcodes.USER_BUSY )
  }

  /**
    Answer this (inbound) call and store a channel which can be used.
    @return {Promise} Returns a promise which resolves if the call is answered, otherwise rejects the promise.
    This framework will catch and cleanup this call if this is rejected.
  */
  async answer( options = {} ) {

    if( this.canceled || this.established ) return

    options = { ...callmanager.options, ...this.options, ...options }
    this.sdp.remote = sdpgen.create( this._req.msg.body )

    /* options.preferedcodecs may have been narrowed down so we still check callmanager as well */
    this.selectedcodec = this.sdp.remote.intersection( options.preferedcodecs, true )
    if( false === this.selectedcodec ) {
      this.selectedcodec = this.sdp.remote.intersection( callmanager.options.preferedcodecs, true )
    }

    let target = this.sdp.remote.getaudio()
    if( !target ) return

    this.sdp.remote.select( this.selectedcodec )
    let channeldef = {
      "target": {
        "address": target.address,
        "port": target.port,
        "codec": target.audio.payloads[ 0 ]
        /*
        dtls:{
          fingerprint: "",
          setup: ""
        }
        */
      }
    }

    let ch = await projectrtp.openchannel( channeldef, this._handlechannelevents.bind( this ) )
    this.channels.audio = ch
    this.sdp.local = sdpgen.create()
              .addcodecs( this.selectedcodec )
              .setconnectionaddress( ch.local.address )
              .setaudioport( ch.local.port )

    if( this.canceled ) return

    if( true === callmanager.options.rfc2833 ) {
      this.sdp.local.addcodecs( "2833" )
    }

    let dialog = await callmanager.options.srf.createUAS( this._req, this._res, {
      localSdp: this.sdp.local.toString(),
      headers: {
         "User-Agent": "project",
         "Supported": "replaces"
       }
    } )

    this.established = true
    this._dialog = dialog
    this.sip.tags.local = dialog.sip.localTag
    callstore.set( this )

    this._addevents( this._dialog )

    this._em.emit( "call.answered", this )
    callmanager.options.em.emit( "call.answered", this )
  }

  /**
    Private helper function to add events to our RTP channel.
    @param {object} e - the rtp event
    @private
  */
  _handlechannelevents( e ) {
    switch( e.action ) {
      case "close": {
        break
      }
      case "telephone-event": {
        this._tevent( e.event )
      }
    }
  }

  /**
    If we have been placed on hold (and it has been neotiated) then configure audio to match.
    @private
  */
  _hold() {

    if( this.state.held ) return
    this.state.held = true

    this.channels.audio.direction( { "send": false, "recv": false } )
    this.sdp.local.setaudiodirection( "inactive" )

    let other = this.other
    if( other ) {
      this.audio.unmix()
      other.audio.play( callmanager.options.moh )
    }

    this._em.emit( "call.hold", this )
    callmanager.options.em.emit( "call.hold", this )
  }

  /**
    Same as _hold.
    @private
  */
  _unhold() {
    if( !this.state.held ) return
    this.state.held = false

    this.channels.audio.direction( { "send": true, "recv": true } )
    this.sdp.local.setaudiodirection( "sendrecv" )

    let other = this.other
    if( other ) {
      this.channels.audio.mix( other.channels.audio )
    }

    this._em.emit( "call.unhold", this )
    callmanager.options.em.emit( "call.unhold", this )
  }

  /**
    As part of the transfer flow a subscription is implied during a transfer which we must update the transferee.
    @private
  */
  async _notifyreferfail() {
    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer;id=" + this.referreq.get( "cseq" ).match( /(\d+)/ )[ 0 ],
        "Subscription-State": "terminated;reason=error",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 400 Ok\r\n"
    }

    await this._dialog.request( opts ).catch( ( e ) => {
      console.error( e )
    } )
  }

  /**
    As part of the transfer flow a subscription is implied during a transfer which we must update the transferee.
    @private
  */
  async _notifyrefercomplete() {
    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer;id=" + this.referreq.get( "cseq" ).match( /(\d+)/ )[ 0 ],
        "Subscription-State": "terminated;reason=complete",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 200 Ok\r\n"
    }

    await this._dialog.request( opts )
      .catch( ( e ) => {
        console.error( e )
      } )
  }

  /**
    As part of the transfer flow a subscription is implied during a transfer which we must update the transferee.
    @private
  */
  async _notifyreferstart() {
    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer;id=" + this.referreq.get( "cseq" ).match( /(\d+)/ )[ 0 ],
        "Subscription-State": "active;expires=60",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 100 Trying\r\n"
    }

    await this._dialog.request( opts )
      .catch( ( e ) => {
        console.error( e )
      } )
  }

  /**
    Send out modified SDP to get the audio to the new location.
    @private
  */
  async _modifyforxfer() {
    this.sdp.local.setaudiodirection( "sendrecv" )
    await this._dialog.modify( this.sdp.local.toString() )
      .catch( ( e ) => {
        console.error( e )
      } )
  }

  /**
    Add events for the drachtio dialog object that this object requires.
    @private
  */
  _addevents( dialog ) {

    /* Drachtio doesn't appear to have finished SE support, i.e. it sends
    a regular INVITE when we set the Supported: timer and Session-Expires headers
    but it doesn't appear to indicate to us when it does fail. It most cases our
    RTP stall timer will kick in first, but if a call is placed on hold followed
    by AWOL... */
    this._timers.seinterval = setInterval( async () => {
      let opts = {
        "method": "INVITE",
        "body": this.audio.localsdp.toString()
      }

      let res = await dialog.request( opts )
        .catch( ( e ) => {
          console.error( e )
          this.hangup( hangupcodes.USER_GONE )
        } )

      if( !this.destroyed && 200 != res.msg.status ) {
        this.hangup( hangupcodes.USER_GONE )
      }

    }, callmanager.options.seexpire )

    dialog.on( "destroy", async ( req ) => {
      await this._onhangup( "wire" )
    } )

    dialog.on( "modify", ( req, res ) => {
      //  The application must respond, using the res parameter provided.
      if( "INVITE" === req.msg.method ) {

        let sdp = sdpgen.create( req.msg.body )
        let media = sdp.getmedia()

        if( ( "inactive" === media.direction || "0.0.0.0" === sdp.sdp.connection.ip ) && !this.state.held ) {
          this._hold()
          res.send( 200, {
            "headers": {
              "Subject" : "Call on hold",
              "User-Agent": "project",
              "Allow": "INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY",
              "Supported": "replaces"
            },
            "body": this.sdp.local.toString()
          } )
        } else if( "inactive" !== media.direction && "0.0.0.0" !== sdp.sdp.connection.ip && this.state.held ) {
          this._unhold()
          res.send( 200, {
            "headers": {
              "Subject" : "Call off hold",
              "User-Agent": "project"
            },
            "body": this.sdp.local.toString()
          } )
        } else {
          /* Unknown - but respond to keep the call going */
          res.send( 200, {
            "headers": {
              "Subject" : "Ok",
              "User-Agent": "project"
            },
            "body": this.sdp.local.toString()
          } )
        }
      }
    } )

    dialog.on( "refer", async ( req, res ) => {
      /*
        We only support the xfer of 2 legged calls. The xfered call will pick up
        the auth from the transferee. For example, inbound anonymous call, gets handled
        by user 1. User 1 then refers - to internal extension, so this can has now been
        authed by user 1 - so has access to internal extenions.
      */
      if( !this.other ) return res.send( 400, "1 legged calls" )

      /* If the invite was authed - then we auth the refer */
      if( this.state.authed ) {
        if( !this._auth.has( req ) ) {
          return this._auth.requestauth( this._req, this._res )
        }
        await this._onauth( req )
        if( this.destroyed ) return
      }

      if( !req.has( "refer-to" ) ) {
        res.send( 400, "Bad request - no refer-to" )
        return
      }

      let referto = req.getParsedHeader( "refer-to" )
      let parsedrefuri = parseuri( referto.uri )

      if( !parsedrefuri || !parsedrefuri.user ) {
        res.send( 400, "Bad request - no refer-to user" )
        return
      }

      if( !parsedrefuri.host ) {
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
        return this._runattendedxfer( req, res, replaces, replacesuri )
      } else {
        this._runblindxfer( req, res, referto )
      }
    } )
  }

  /**
  We have authed, parsed the headers and decided we have been asked to perform
  a blind xfer on the other leg.
  @private
  */
  _runblindxfer( req, res, referto ) {
    let othercall = this.other
    if( !othercall ) return res.send( 400, "We have no-one to refer" )

    othercall.state.refered = true

    this.detach()
    res.send( 202 )
    this._notifyreferstart()

    othercall.referingtouri = referto.uri
    this._em.emit( "call.new", othercall )
    callmanager.options.em.emit( "call.new", othercall )
    this._notifyrefercomplete()

    /* As part of the call flow the client will send us a hangup next - so only set the cause */
    this.hangup_cause = Object.assign( { "src": "wire" }, hangupcodes.BLIND_TRANSFER )
  }

  /**
  Attended xfers have 4 calls. 2 pairs.
  a_1 -> b_1
  b_2 -> c_1

  b wants to connect a and c and then step out of the way
  where b_2 is the active call and b_1 is the one b placed on hold
  therefore b_2 = this

  It is also pottential this could be requested
  a_1 -> b_1
  b_2 <- c_1

  or

  a_1 <- b_1
  b_2 -> c_1

  or

  a_1 <- b_1
  b_2 <- c_1

  ends up with
  a_1 - c_1

  An attended transfer could also go to an application - not other call:
  a_1 <- b_1
  b_2 - conference

  ends up with
  a_1 - b_2 (rtp channel)

  @private
  */
  async _runattendedxfer( req, res, replaces, replacesuri ) {
    let totag = replacesuri.match( /to-tag=(.*?)(;|$)/i )
    let fromtag = replacesuri.match( /from-tag=(.*?)(;|$)/i )

    if( replaces.length < 3 || totag.length < 3 || fromtag.length < 3 ) {
      res.send( 400, "Bad call reference for replaces" )
      return
    }

    let searchfor = { "callid": replaces[ 1 ], "tags": { "local": totag[ 1 ], "remote": fromtag[ 1 ] } }
    let failed = false

    let b_1 = await callstore.getbycallid( searchfor )
      .catch( ( e ) => {
        console.error( e )
        res.send( 400, e )
        failed = true
      } )
    if( failed || !b_1 ) return res.send( 400, "No call matches that call id" )
    if( !b_1.sdp.remote ) return res.send( 400, "No remote sdp negotiated (b_1)!" )
    let b_2 = this /* so we can follow the above terminology */

    let c_1 = b_2.other
    if( !c_1 ) c_1 = b_2

    let a_1 = b_1.other
    if( !a_1 ) return res.send( 400, "Can't attened xfer 1 legged calls" )
    if( !a_1.sdp.remote ) return res.send( 400, "No remote sdp negotiated (a_1)!" )

    if( !a_1.channels.audio ) return res.send( 400, "No channel (a_1)" )
    if( !b_1.channels.audio ) return res.send( 400, "No channel (b_1)" )
    if( !b_2.channels.audio ) return res.send( 400, "No channel (b_2)" )
    if( !c_1.channels.audio ) return res.send( 400, "No channel (c_1)" )

    b_1.detach()
    b_2.detach()

    /* Swap channels and update */
    let a_1_audio = a_1.channels.audio
    let a_1_sdp = a_1.sdp.local

    a_1.channels.audio = b_2.channels.audio
    a_1.sdp.local = b_2.sdp.local

    a_1.sdp.local
      .clearcodecs()
      .addcodecs( a_1.selectedcodec )
      .select( a_1.selectedcodec )
      .setaudiodirection( "sendrecv" )

    if( true === callmanager.options.rfc2833 ) {
      a_1.sdp.local.addcodecs( "2833" )
    }

    /* Link logically */
    a_1.children.add( c_1 )
    c_1.parent = a_1

    /* this one will be hung up soon anyway - so it to has to close the correct one  */
    b_2.channels.audio = a_1_audio
    b_2.sdp.local = a_1_sdp

    failed = false

    await new Promise( ( resolve ) => {
      res.send( 202, "Refering", {}, ( err, response ) => {
        resolve()
      } )
    } )

    failed = false
    await this._notifyreferstart()
      .catch( ( e ) => {
        console.error( e )
        this._notifyreferfail()
        failed = true
      } )

    if( failed ) return

    /* modify ports and renegotiate codecs */
    await a_1._modifyforxfer()

    let target = a_1.sdp.remote.getaudio()
    if( target ) {
      /* we should always get in here */
      a_1.channels.audio.target( call._createchanneltargetdef( target.address, target.port, a_1.selectedcodec ) )

      /* there might be situations where mix is not the correct thing - perhaps a pop push application? */
      a_1.channels.audio.mix( c_1.channels.audio )

      /* Now inform our RTP server also - we might need to wait untl the target has completed so need a notify mechanism */
      a_1.channels.audio.direction( { "send": false, "recv": false } )
    }

    this._notifyrefercomplete()

    a_1.state.refered = true

    this.hangup_cause = Object.assign( { "src": "wire" }, hangupcodes.ATTENDED_TRANSFER )
    b_1.hangup( hangupcodes.ATTENDED_TRANSFER )
  }

  /**
  Helper function to create a channel target definition
  @private
  */
  static _createchanneltargetdef( address, port, codec ) {
    return {
      "target": {
        "address": address,
        "port": port,
        "codec": codec
        /*
        dtls:{
          fingerprint: "",
          setup: ""
        }
        */
      }
    }
  }

  /**
  Sets our hangup cause correctly - if not already set.
  @private
  */
  _sethangupcause( src, reason ) {
    if( !this.hangup_cause ) {
      if( reason ) {
        this.hangup_cause = reason
      } else {
        this.hangup_cause = hangupcodes.NORMAL_CLEARING
        if( "wire" === src && !this.state.established ) {
          this.hangup_cause = hangupcodes.ORIGINATOR_CANCEL
        }
      }
      /* make sure we don't copy src back into our table of causes */
      this.hangup_cause = Object.assign( { "src": src }, this.hangup_cause )
    }
  }

  /**
    When our dialog has confirmed we have hung up
    @param {string} [us] - "us"|"wire"
    @param {object} reason - one of the reasons from the hangupcodes enum - only used if we havn't alread set our reason
    @private
  */
  async _onhangup( src = "us", reason ) {

    if( this.destroyed ) return
    this.destroyed = true

    this._sethangupcause( src, reason )

    let wasestablished = this.established

    let r = this._promises.resolve.hangup
    this._promises.promise.hangup = false
    this._promises.resolve.hangup = false
    try{
      if( r ) r()
    } catch( e ) {
      console.error( e )
    }

    if( this.channels.audio ) {
      this.channels.audio.close()
    }
    this.channels.audio = false

    callstore.delete( this )

    if( this.parent && true === wasestablished ) {
      await this.parent.hangup( this.hangup_cause )
    }

    for( let child of this.children ) {
      await child.hangup( this.hangup_cause )
    }

    this._em.emit( "call.destroyed", this )
    callmanager.options.em.emit( "call.destroyed", this )
    this._cleanup()
  }

  /**
    Use this as our destructor. This may get called more than once depending on what is going on
    @private
  */
  _cleanup() {

    if( this.state.cleaned ) return
    this.state.cleaned = true

    /* Clean up promises (ensure they are resolved) and clear any timers */
    if( this._promises.reject.auth ) this._promises.reject.auth( this )

    if( undefined !== this._timers.auth ) clearTimeout( this._timers.auth )
    this._timers.auth = false

    if( this._timers.events ) clearTimeout( this._timers.events )
    this._timers.events = false

    if( this._promises.resolve.events ) this._promises.resolve.events( this )
    this._promises.resolve.events = false

    if( this._promises.resolve.hangup ) this._promises.resolve.hangup( this )
    this._promises.resolve.hangup = false

    if( this._timers.newuac ) clearTimeout( this._timers.newuac )
    this._timers.newuac = false

    if( this._timers.seinterval ) clearInterval( this._timers.seinterval )
    this._timers.seinterval = false
  }

  /**
    Hangup the call with reason.
    @param {object} reason - one of the reasons from the hangupcodes enum
  */
  async hangup( reason ) {

    if( this.destroyed ) return

    this._sethangupcause( "us", reason )

    if( this.established ) {
      try {
        await this._dialog.destroy()
      } catch( e ) { console.error( e ) }

    } else if( "uac" === this.type ) {
      try {
        this._req.cancel()
      } catch( e ) { console.error( e ) }

      this.canceled = true

    } else {
      try {
        this._res.send( this.hangup_cause.sip )
      } catch( e ) { console.error( e ) }
    }

    await this._onhangup( "us", reason )
  }

  async waitforhangup() {
    if( this.destroyed ) return

    if( !this._promises.promise.hangup ) {
      this._promises.promise.hangup = new Promise( ( resolve ) => {
        this._promises.resolve.hangup = resolve
      } )
    }

    await this._promises.resolve.hangup
    this._promises.promise.hangup = false
    this._promises.resolve.hangup = false

  }

  _requestauth() {
    this.send( 407 )
  }
}

module.exports.call = call
module.exports.hangupcodes = hangupcodes
module.exports.setcallmanager = function( cm ) { callmanager = cm }
