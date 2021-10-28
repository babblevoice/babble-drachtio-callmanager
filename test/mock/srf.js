

/*
Mock req object
*/
class req {
  constructor() {
    this.parsedheaders = {}
    this.method = "INVITE"

    this.source_address = "127.0.0.1"
    this.source_port = 5060
    this.protocol = "udp"
    this.entity = {
      "uri": "1000@domain"
    }

    this.events = {}
  }

  getParsedHeader( header ) {
    return this.parsedheaders[ header ]
  }

  setparsedheader( header, value ) {
    this.parsedheaders[ header ] = value
  }

  cancel() {
    if( this.events.cancel ) {
      this.events.cancel()
    }
  }

  on( event, cb ) {
    this.events[ event ] = cb
  }
}


module.exports.req = req
