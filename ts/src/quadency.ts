'use strict';

// import { BadRequest, AuthenticationError, PermissionDenied, ArgumentsRequired, ExchangeError } from '../ccxt';
import type { Balances, OHLCV, Order, OrderSide, OrderType, Ticker } from './base/types.js';
import { sha256 } from './static_dependencies/noble-hashes/sha256.js';
import Exchange from './abstract/quadency.js';
import { BadRequest, AuthenticationError, PermissionDenied, ArgumentsRequired, ExchangeError } from './base/errors.js';

// const { ExchangeError, PermissionDenied, BadRequest, AuthenticationError, ArgumentsRequired } = require ('./base/errors');

export default class quadency extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'quadency',
            'name': 'Quadency',
            'countries': [],
            'rateLimit': 1000,
            'has': {
                'CORS': undefined,
                'spot': true,
                'margin': undefined,
                'swap': undefined,
                'future': undefined,
                'option': undefined,
                'createOrder': true,
                'fetchBalance': true,
                'fetchMarkets': true,
                'fetchMyTrades': true,
                'fetchOHLCV': true,
                'fetchTicker': true,
            },
            'timeframes': {
                '1m': '1', // default
                '5m': '5',
                '15m': '15',
                '30m': '30',
                '1h': '60',
                '4h': '240',
                '1d': '1440',
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/27790564-a945a9d4-5ff9-11e7-9d2d-b635763f2f24.jpg',
                'api': {
                    'public': 'https://quadency.com/api/v1/public/quadx',
                    'private': 'https://quadency.com/api/v1/private/quadx',
                },
                'test': {
                    'public': 'https://staging.quadency.com/api/v1/public/quadx',
                    'private': 'https://staging.quadency.com/api/v1/private/quadx',
                },
                'www': 'https://quadency.com',
            },
            'api': {
                'public': {
                    'get': [
                        'markets',
                        'ticker',
                        'ohlcv',
                    ],
                },
                'private': {
                    'get': [
                        'trades',
                        'balances',
                    ],
                    'post': [
                        'order',
                    ],
                },
            },
            'exceptions': {
                '400': BadRequest,
                '401': AuthenticationError,
                '403': AuthenticationError,
                '429': PermissionDenied,
            },
            'errorMessages': {
                '400': 'Incorrect parameters',
                '401': 'Incorrect keys or ts value differs from the current time by more than 5 seconds',
                '404': 'Not Found',
                '429': 'Too Many Requests: API Rate Limits violated',
                '500': 'Internal Server Error',
                '503': 'System is currently overloaded.',
            },
        });
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'][api];
        url += '/' + this.implodeParams (path, params);
        const query = this.omit (params, this.extractParams (path));
        if (Object.keys (query).length) {
            url += '?' + this.urlencode (query);
        }
        if (api === 'private') {
            const ts = this.nonce () * 1000;
            const strTs = ts.toString ();
            const apiPath = url.split ('.com')[1];
            const message = strTs + method + apiPath;
            const signature = this.hmac (this.encode (message), this.encode (this.secret), sha256, 'hex');
            headers = {
                'ACCESS-KEY': this.apiKey,
                'ACCESS-SIGN': signature,
                'ACCESS-TIMESTAMP': strTs,
                'QUADX': 'true',
            };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    parseTradeFee (trade, quote) {
        if ('fee' in trade) {
            const fee = trade['fee'];
            return {
                'cost': this.safeFloat (fee, 'cost', 0),
                'currency': this.safeString (fee, 'currency', quote),
                'rate': this.safeFloat (fee, 'rate', 0),
            };
        }
        return { 'cost': 0, 'currency': quote, 'rate': 0 };
    }

    parseTrade (trade, market = undefined) {
        const timestamp = this.safeInteger (trade, 'e_timestamp');
        const price = this.safeFloat (trade, 'price');
        const amount = this.safeFloat (trade, 'amount');
        const id = this.safeString (trade, 'e_tradeId');
        const orderId = this.safeString (trade, 'e_orderId');
        const side = trade['side'];
        const quote = this.safeString (market, 'quote', 'QUAD');
        return {
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': trade['pair'],
            'id': id,
            'order': orderId,
            'type': undefined,
            'takerOrMaker': undefined,
            'side': side,
            'price': price,
            'amount': amount,
            'cost': price * amount,
            'fee': this.parseTradeFee (trade, quote),
        };
    }

    async fetchMyTrades (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchMyTrades requires a symbol argument');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'pairs': market['symbol'],
        };
        if (since !== undefined) {
            request['since'] = since.toString ();
        }
        if (limit !== undefined) {
            request['limit'] = limit.toString ();
        }
        const response = await this.privateGetTrades (this.extend (request, params));
        return this.parseTrades (response, market, since, limit);
    }

    parseBaseAssets (baseSymbol, symbol, baseAssets) {
        const [ base, quote ] = symbol.split ('/');
        return {
            'id': symbol.replace ('/', ''),
            'symbol': symbol,
            'base': base,
            'quote': quote,
            'baseId': base,
            'quoteId': quote,
            'precision': baseAssets[baseSymbol]['precision'],
            // this will be deprecated soon ***
            'taker': this.safeFloat (baseAssets[baseSymbol], 'takerFee') / 100,
            'maker': this.safeFloat (baseAssets[baseSymbol], 'makerFee') / 100,
            'limits': {
                'amount': {
                    'min': this.safeFloat (baseAssets[baseSymbol]['limits']['amount'], 'min'),
                    'max': this.safeFloat (baseAssets[baseSymbol]['limits']['amount'], 'max'),
                },
                'price': {
                    'min': this.safeFloat (baseAssets[baseSymbol]['limits']['price'], 'min'),
                    'max': this.safeFloat (baseAssets[baseSymbol]['limits']['price'], 'max'),
                },
                'cost': {
                    'min': this.safeFloat (baseAssets[baseSymbol]['limits']['cost'], 'min'),
                    'max': this.safeFloat (baseAssets[baseSymbol]['limits']['cost'], 'max'),
                },
            },
            'active': baseAssets[baseSymbol]['buyEnabled'] || baseAssets[baseSymbol]['sellEnabled'],
            'percentage': true,
            'info': {
                'buyEnabled': baseAssets[baseSymbol]['buyEnabled'],
                'sellEnabled': baseAssets[baseSymbol]['sellEnabled'],
                'quadDiscount': this.safeFloat (baseAssets[baseSymbol], 'quadDiscount'),
                'slippageTolerance': this.safeFloat (baseAssets[baseSymbol], 'slippageTolerance'),
                'priceDeviationTolerance': this.safeFloat (baseAssets[baseSymbol], 'priceDeviationTolerance'),
                'liquiditySource': baseAssets[baseSymbol]['liquiditySource'],
                'markupBuy': this.safeFloat (baseAssets[baseSymbol], 'markupBuy'),
                'markupSell': this.safeFloat (baseAssets[baseSymbol], 'markupSell'),
                'filters': baseAssets[baseSymbol]['filters'],
            },
        };
    }

    async fetchMarkets (params = {}) {
        // this will be deprecated soon ***
        const response = await this.publicGetMarkets ();
        const USDCBaseAssets = response['markets']['quoteAssets']['USDC']['baseAssets'];
        const USDTBaseAssets = response['markets']['quoteAssets']['USDT']['baseAssets'];
        const USDCBaseSymbols = Object.keys (USDCBaseAssets);
        const USDTBaseSymbols = Object.keys (USDTBaseAssets);
        const result = [];
        for (let i = 0; i < USDCBaseSymbols.length; i++) {
            const entry = this.parseBaseAssets (USDCBaseSymbols[i], USDCBaseAssets[USDCBaseSymbols[i]]['liquidityPair'], USDCBaseAssets);
            result.push (entry);
        }
        for (let i = 0; i < USDTBaseSymbols.length; i++) {
            const entry = this.parseBaseAssets (USDTBaseSymbols[i], USDTBaseAssets[USDTBaseSymbols[i]]['liquidityPair'], USDTBaseAssets);
            result.push (entry);
        }
        return result;
    }

    parseTicker (response): Ticker {
        return this.safeTicker ({
            'price': this.safeFloat (response, 'price'),
            'last': this.safeFloat (response, 'last'),
            'close': this.safeFloat (response, 'close'),
            'high': this.safeFloat (response, 'high'),
            'low': this.safeFloat (response, 'low'),
            'price24h': this.safeFloat (response, 'price24h'),
            'volume': this.safeFloat (response, 'volume'),
            'volume24h': this.safeFloat (response, 'volume24h'),
        });
    }

    async fetchTicker (symbol, params = {}) {
        const request = { 'pair': symbol };
        const response = await this.publicGetTicker (this.extend (request, params));
        return this.parseTicker (response);
    }

    async fetchOHLCV (symbol, timeframe = '1h', since = undefined, limit = 1000, params = {}): Promise<OHLCV[]> {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const duration = this.parseTimeframe (timeframe);
        if (since === undefined) {
            since = this.milliseconds () - limit * duration * 1000;
        }
        const endDate = since + limit * duration * 1500;
        params = { 'pair': market['symbol'], 'interval': timeframe, 'startDate': since.toString (), 'endDate': endDate.toString () };
        return await this.publicGetOhlcv (this.extend (params));
    }

    // parseOrder (order, market: Market = undefined): Order {
    parseOrder (order, market): Order {
        let status = undefined;
        if ('status' in order) {
            status = this.safeString (order, 'status');
            if (status.toLowerCase () === 'ok') {
                status = 'closed';
            } else if (status.toLowerCase () === 'failed') {
                status = 'rejected';
            } else if (status.toLowerCase () === 'cancelled' || status.toLowerCase () === 'canceled') {
                status = 'canceled';
            }
        }
        let id = undefined;
        if ('orderId' in order) {
            id = this.safeString (order, 'orderId');
        }
        let pair = market;
        if ('pair' in order) {
            pair = this.safeString (order, 'pair');
        }
        let side = order.side;
        if ('side' in order) {
            side = this.safeString (order, 'side');
        }
        let price = undefined;
        if ('price' in order) {
            price = this.safeFloat (order, 'price');
        }
        let type = 'MARKET';
        if ('type' in order) {
            type = this.safeString (order, 'type');
        }
        let filled = undefined;  // qty size NOT quote
        if ('purchaseAmount' in order) {
            filled = this.safeFloat (order, 'purchaseAmount');
            if (side.toLowerCase () === 'sell') {
                filled = filled / price;
            }
        }
        let amount = order.amount;  // qty size NOT quote
        if ('orderAmount' in order) {
            if (side.toLowerCase () === 'sell') {
                amount = this.safeFloat (order, 'orderAmount');
            } else {
                amount = filled;
            }
        }
        let timestamp = undefined;
        if ('timestamp' in order) {
            timestamp = order['timestamp'];
        } else {
            timestamp = this.nonce () * 1000;
        }
        let remaining = undefined;
        let cost = undefined;  // this is the quote cost
        if (filled !== undefined) {
            if (price !== undefined) {
                cost = price * filled;
            }
            if (amount !== undefined) {
                remaining = amount - filled;
                remaining = Math.max (remaining, 0.0);
            }
        }
        let average = undefined;  // execution avg price
        if (cost !== undefined) {
            if (filled) {
                average = cost / filled;
            }
        }
        const fee = undefined;
        const trades = undefined;
        return this.safeOrder ({
            'info': order,
            'id': id,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'lastTradeTimestamp': undefined,
            'symbol': pair,
            'type': type,
            'side': side,
            'price': price,
            'amount': amount,
            'cost': cost,
            'average': average,
            'filled': filled,
            'remaining': remaining,
            'status': status,
            'fee': fee,
            'trades': trades,
        });
    }

    async createOrder (symbol: string, type: OrderType, side: OrderSide, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'pair': market['symbol'],
            'side': side,
            'amount': amount,
        };
        if (price) {
            request['price'] = price.toString ();
        }
        const response = await this.privatePostOrder (this.extend (request, params));
        return this.parseOrder (response, market);
    }

    async fetchBalance (params = {}): Promise<Balances> {
        await this.loadMarkets ();
        const balances = await this.privateGetBalances (this.extend (params));
        const result = { 'info': balances };
        for (let i = 0; i < balances.length; i++) {
            const balance = balances[i];
            result[balance['asset']] = { 'used': this.safeFloat (balance, 'used'), 'free': this.safeFloat (balance, 'free'), 'total': this.safeFloat (balance, 'total') };
        }
        return result;
    }

    handleErrors (statusCode, statusText, url, method, responseHeaders, responseBody, response, requestHeaders, requestBody) {
        if (response === undefined) {
            return undefined;
        }
        if (statusCode >= 400) {
            //
            //     {"error":{"timestamp":"05.12.2019T05:25:43.584+0000","status":"BAD_REQUEST","message":"Insufficient ETH balance. Required: 1, actual: 0.","code":4001}}
            //     {"error":{"timestamp":"05.12.2019T04:03:25.419+0000","status":"FORBIDDEN","message":"Access denied","code":4300}}
            //
            const feedback = this.id + ' ' + responseBody;
            let error = this.safeValue (response, 'error');
            if (error === undefined) {
                error = response;
            }
            const code = this.safeString2 (error, 'code', 'status');
            const message = this.safeString2 (error, 'message', 'debugMessage');
            this.throwBroadlyMatchedException (this.exceptions['broad'], message, feedback);
            this.throwExactlyMatchedException (this.exceptions['exact'], code, feedback);
            this.throwExactlyMatchedException (this.exceptions['exact'], message, feedback);
            throw new ExchangeError (feedback);
        }
        return undefined;
    }
}
