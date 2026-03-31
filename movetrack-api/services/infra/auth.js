const { expressjwt: jwt } = require('express-jwt');
var jwks = require('jwks-rsa');

var jwtProdCheck = jwt({
    secret: jwks.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: 'https://take-stock.us.auth0.com/.well-known/jwks.json'
    }),
    audience: 'https://api-endpoint.take-stock.app',
    issuer: 'https://take-stock.us.auth0.com/',
    algorithms: ['RS256']
});

var jwtDemoCheck = jwt({
    secret: jwks.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: 'https://take-stock-demo.us.auth0.com/.well-known/jwks.json'
    }),
    audience: 'https://take-stock.app/api-endpoint',
    issuer: 'https://take-stock-demo.us.auth0.com/',
    algorithms: ['RS256']
});

module.exports = { jwtProdCheck, jwtDemoCheck } ;