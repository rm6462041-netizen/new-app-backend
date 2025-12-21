const express = require('express');
const app = express();

// Import middlewares
const corsMiddleware = require('./middleware/cors');

// Import routes
const authRoutes = require('./routes/auth');
const tradeRoutes = require('./routes/trade');
const screenshotRoutes = require('./routes/screenshot');
const analyticsRoutes = require('./routes/analytics');
const passwordRoutes = require('./routes/password');
const mt5Routes = require('./routes/mt5');

// Middleware
app.use(corsMiddleware);
app.use(express.json());

// Rnodoutes
app.use('/api', authRoutes);
app.use('/api', tradeRoutes);
app.use('/api', screenshotRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', passwordRoutes);
app.use('/api', mt5Routes);


// HEALTH CHECK
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is running!',
        endpoints: [
            'POST /api/register',
            'POST /api/login', 
            'POST /api/update-profile',
            'POST /api/update-password',
            'POST /api/update-account-type',
            'POST /api/update-currency',
            'GET  /api/user-profile/:userid',
            
            // TRADE MANAGEMENT
            'POST /api/save-trade',
            'POST /api/save-bulk-trades',
            'POST /api/save-api-trade',
            'GET  /api/user-trades/:userid',
            'GET  /api/user-api-trades/:userid',
            'DELETE /api/trades/:id',
            'DELETE /api/api-trades/:id',
            'GET  /api/trade-summary/:userid',
            
            // DAILY VIEW
            'GET  /api/trades-by-date/:userid?date=YYYY-MM-DD',
            'GET  /api/trades-by-date-range/:userid?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD',
            'POST /api/update-trade-note',
            
            // SCREENSHOT
            'POST /api/upload-screenshot',
            'POST /api/update-trade-screenshots',
            'DELETE /api/trade-screenshot',
            'GET  /api/trade-with-screenshots/:tradeId',
            
            // PASSWORD
            'POST /api/forgot-password',
            'POST /api/reset-password'
        ]
    });
});

// START SERVER
app.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
    console.log('✅ Modular structure ready!');
    console.log('📁 Check all routes in /routes/ directory');
});