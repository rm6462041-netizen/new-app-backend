const corsMiddleware = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', '*');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
};

module.exports = corsMiddleware;