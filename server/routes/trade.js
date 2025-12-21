const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// SAVE MANUAL TRADE
router.post('/save-trade', async (req, res) => {
    const { 
        userId, symbol, trade_type, category, quantity, price, exit_price,
        pnl, strategy, timestamp, notes, screenshots
    } = req.body;

    console.log("💾 SAVE MANUAL TRADE:", { userId, symbol });

    try {
        const screenshotsJson = screenshots 
            ? (Array.isArray(screenshots) ? JSON.stringify(screenshots) : JSON.stringify([screenshots]))
            : null;

        await pool.query(
            `INSERT INTO trades 
             (user_id, symbol, trade_type, category, quantity, price, exit_price, pnl, strategy, timestamp, notes, screenshots) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [userId, symbol, trade_type, category, quantity, price, exit_price, pnl, strategy, timestamp, notes, screenshotsJson]
        );

        console.log("✅ MANUAL TRADE SAVED SUCCESSFULLY");
        res.json({ 
            success: true, 
            message: 'Manual trade saved!',
            screenshotCount: screenshotsJson ? JSON.parse(screenshotsJson).length : 0
        });

    } catch (error) {
        console.log("❌ Manual Trade Save Error:", error.message);
        res.json({ success: false, error: error.message });
    }
});

// SAVE BULK TRADES
router.post('/save-bulk-trades', async (req, res) => {
    const { trades } = req.body;

    console.log("💾 SAVE BULK TRADES - Received:", trades?.length || 0, "trades");

    if (!trades || !Array.isArray(trades)) {
        return res.json({ success: false, error: 'Invalid trades data' });
    }

    const MAX_TRADES_PER_REQUEST = 500;
    if (trades.length > MAX_TRADES_PER_REQUEST) {
        return res.json({ 
            success: false, 
            error: `Too many trades. Maximum ${MAX_TRADES_PER_REQUEST} trades per request.` 
        });
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const trade of trades) {
        try {
            const exitPrice = trade.exit_price || trade.closing_price;
            const entryPrice = trade.price || trade.opening_price;
            const tradeType = trade.trade_type || trade.type;
            const tradeQuantity = trade.quantity || trade.lots;
            const tradeTimestamp = trade.timestamp || trade.opening_time_utc;
            const tradePNL = trade.pnl || trade.profit_usd || 0;
            const tradeNotes = trade.notes || null;
            const tradeScreenshots = trade.screenshots || null;
            
            const screenshotsJson = tradeScreenshots 
                ? (Array.isArray(tradeScreenshots) ? JSON.stringify(tradeScreenshots) : JSON.stringify([tradeScreenshots]))
                : null;

            if (!trade.userId) {
                results.push({ success: false, trade: trade.symbol, error: 'Missing userId' });
                errorCount++;
                continue;
            }
            if (!trade.symbol) {
                results.push({ success: false, trade: 'Unknown', error: 'Missing symbol' });
                errorCount++;
                continue;
            }
            if (!tradeType) {
                results.push({ success: false, trade: trade.symbol, error: 'Missing trade_type' });
                errorCount++;
                continue;
            }
            if (!tradeQuantity || tradeQuantity <= 0) {
                results.push({ success: false, trade: trade.symbol, error: 'Invalid quantity' });
                errorCount++;
                continue;
            }
            if (!entryPrice || entryPrice <= 0) {
                results.push({ success: false, trade: trade.symbol, error: 'Invalid price' });
                errorCount++;
                continue;
            }
            if (!exitPrice || exitPrice <= 0) {
                results.push({ success: false, trade: trade.symbol, error: 'Invalid exit_price' });
                errorCount++;
                continue;
            }
            if (!tradeTimestamp) {
                results.push({ success: false, trade: trade.symbol, error: 'Missing timestamp' });
                errorCount++;
                continue;
            }

            const normalizedTradeType = tradeType.toLowerCase().includes('buy') ? 'buy' : 
                                      tradeType.toLowerCase().includes('sell') ? 'sell' : tradeType;

            await pool.query(
                `INSERT INTO trades 
                 (user_id, symbol, trade_type, category, quantity, price, exit_price, pnl, strategy, timestamp, notes, screenshots) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    trade.userId,
                    trade.symbol,
                    normalizedTradeType,
                    trade.category || 'forex',
                    parseFloat(tradeQuantity),
                    parseFloat(entryPrice),
                    parseFloat(exitPrice),
                    parseFloat(tradePNL) || 0,
                    trade.strategy || null,
                    tradeTimestamp,
                    tradeNotes,
                    screenshotsJson
                ]
            );

            results.push({ success: true, trade: trade.symbol });
            successCount++;

        } catch (error) {
            results.push({ 
                success: false, 
                trade: trade.symbol, 
                error: error.message 
            });
            errorCount++;
        }
    }

    console.log(`✅ BULK TRADES SAVED - Successful: ${successCount}, Failed: ${errorCount}`);
    
    res.json({
        success: true,
        message: `Processed ${trades.length} trades: ${successCount} successful, ${errorCount} failed`,
        savedCount: successCount,
        errorCount: errorCount,
        results: results
    });
});
// *** SAVE API TRADES WITH TICKET CHECK AND DEBUG ***
router.post('/save-api-trade', async (req, res) => {
    try {
        console.log("🔥🔥🔥 /save-api-trade ENDPOINT HIT!");
        let trades = req.body;
        if (!Array.isArray(trades)) trades = [trades];

        console.log(`📊 Processing ${trades.length} trade(s)`);

        const results = [];
        let savedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const trade of trades) {
            try {
                const {
                    account_id, ticket, symbol, type, volume, entry_price, exit_price, profit, close_time
                } = trade;

                if (!account_id || !ticket) {
                    console.log("❌ Trade missing account_id or ticket:", trade);
                    results.push({ success: false, symbol, ticket, error: "account_id or ticket missing" });
                    errorCount++;
                    continue;
                }

                // Lookup user
                const lookup = await pool.query(
                    "SELECT user_id FROM mt5_accounts WHERE account_id = $1",
                    [account_id]
                );

                if (lookup.rows.length === 0) {
                    console.log("❌ Account not linked to any user:", account_id);
                    results.push({ success: false, symbol, ticket, error: "Account not linked to any user" });
                    errorCount++;
                    continue;
                }

                const userId = lookup.rows[0].user_id;

                // Insert trade with ticket UNIQUE check
                const insertQuery = `
                    INSERT INTO api_trades
                    (user_id, account_id, platform, symbol, trade_type, quantity, price, exit_price, pnl, timestamp, ticket)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                    ON CONFLICT (ticket) DO NOTHING
                    RETURNING *;
                `;

                const insertResult = await pool.query(insertQuery, [
                    userId, account_id, 'mt5', symbol, type.toLowerCase(), volume, entry_price, exit_price, profit, close_time, ticket
                ]);

                if (insertResult.rows.length > 0) {
                    console.log("✅ Trade saved:", { ticket, symbol, userId, profit });
                    results.push({ success: true, symbol, ticket, userId, account_id, profit });
                    savedCount++;
                } else {
                    console.log("⚠️ Duplicate ticket, skipped:", { ticket, symbol });
                    results.push({ success: false, symbol, ticket, error: "Duplicate ticket, skipped" });
                    skippedCount++;
                }

            } catch (tradeError) {
                console.log("❌ Trade insert failed:", {
                    ticket: trade.ticket,
                    symbol: trade.symbol,
                    account_id: trade.account_id,
                    error: tradeError.message
                });
                results.push({ success: false, symbol: trade?.symbol, ticket: trade?.ticket, account_id: trade?.account_id, error: tradeError.message });
                errorCount++;
            }
        }

        console.log(`📊 SUMMARY: ${savedCount} saved, ${skippedCount} skipped, ${errorCount} failed`);

        res.json({
            success: true,
            message: `Processed ${trades.length} trades: ${savedCount} saved, ${skippedCount} skipped, ${errorCount} failed`,
            savedCount,
            skippedCount,
            errorCount,
            results
        });

    } catch (error) {
        console.log("❌❌❌ /save-api-trade Error:", error.message);
        res.json({ success: false, error: error.message });
    }
});

// GET MANUAL TRADES
router.get('/user-trades/:userid', async (req, res) => {
    const userId = req.params.userid;

    console.log("📊 GET MANUAL TRADES - User ID:", userId);

    try {
        const result = await pool.query(
            `SELECT * FROM trades WHERE user_id = $1 ORDER BY timestamp DESC`,
            [userId]
        );

        console.log("✅ MANUAL TRADES FETCHED - Count:", result.rows.length);
        res.json({ success: true, trades: result.rows });

    } catch (error) {
        console.log("❌ Get Manual Trades Error:", error.message);
        res.json({ success: false, error: error.message });
    }
});

// GET API TRADES
router.get('/user-api-trades/:userid', async (req, res) => {
    const userId = req.params.userid;

    console.log("🔗 GET API TRADES - User ID:", userId);

    try {
        const result = await pool.query(
            `SELECT * FROM api_trades WHERE user_id = $1 ORDER BY timestamp DESC`,
            [userId]
        );

        console.log("✅ API TRADES FETCHED - Count:", result.rows.length);
        res.json({ success: true, trades: result.rows });

    } catch (error) {
        console.log("❌ Get API Trades Error:", error.message);
        res.json({ success: false, error: error.message });
    }
});

// DELETE MANUAL TRADE
router.delete('/trades/:id', async (req, res) => {
    const tradeId = req.params.id;
    const userId = req.headers['user-id'] || req.query.userId || req.body.userId;

    console.log("🗑️ DELETE MANUAL TRADE - Trade ID:", tradeId, "User ID:", userId);

    if (!tradeId || !userId) {
        return res.json({ 
            success: false, 
            error: 'Trade ID and User ID required' 
        });
    }

    try {
        const checkResult = await pool.query(
            `SELECT * FROM trades WHERE "ID" = $1 AND user_id = $2`,
            [tradeId, userId]
        );

        if (checkResult.rows.length === 0) {
            return res.json({ 
                success: false, 
                error: 'Trade not found or unauthorized' 
            });
        }

        const deleteResult = await pool.query(
            `DELETE FROM trades WHERE "ID" = $1 AND user_id = $2 RETURNING "ID", symbol`,
            [tradeId, userId]
        );

        const deletedTrade = deleteResult.rows[0];
        
        res.json({ 
            success: true, 
            message: 'Trade deleted successfully',
            deletedId: deletedTrade?.ID,
            symbol: deletedTrade?.symbol
        });

    } catch (error) {
        console.log("❌ Delete Manual Trade Error:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// DELETE API TRADE
router.delete('/api-trades/:id', async (req, res) => {
    const tradeId = req.params.id;
    const userId = req.headers['user-id'] || req.query.userId || req.body.userId;

    console.log("🗑️ DELETE API TRADE - Trade ID:", tradeId, "User ID:", userId);

    if (!tradeId || !userId) {
        return res.json({ 
            success: false, 
            error: 'Trade ID and User ID required' 
        });
    }

    try {
        const checkResult = await pool.query(
            `SELECT * FROM api_trades WHERE "ID" = $1 AND user_id = $2`,
            [tradeId, userId]
        );

        if (checkResult.rows.length === 0) {
            return res.json({ 
                success: false, 
                error: 'Trade not found or unauthorized' 
            });
        }

        const deleteResult = await pool.query(
            `DELETE FROM api_trades WHERE "ID" = $1 AND user_id = $2 RETURNING "ID", symbol`,
            [tradeId, userId]
        );

        const deletedTrade = deleteResult.rows[0];
        
        res.json({ 
            success: true, 
            message: 'API Trade deleted successfully',
            deletedId: deletedTrade?.ID,
            symbol: deletedTrade?.symbol
        });

    } catch (error) {
        console.log("❌ Delete API Trade Error:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// UPDATE TRADE NOTES
router.post('/update-trade-note', async (req, res) => {
    const { tradeId, notes, userId } = req.body;

    console.log("📝 UPDATE TRADE NOTE - Trade ID:", tradeId, "User ID:", userId);

    if (!tradeId || !userId) {
        return res.json({ 
            success: false, 
            error: 'Trade ID and User ID required' 
        });
    }

    try {
        const checkResult = await pool.query(
            `SELECT * FROM trades WHERE "ID" = $1 AND user_id = $2`,
            [tradeId, userId]
        );

        if (checkResult.rows.length === 0) {
            return res.json({ 
                success: false, 
                error: 'Trade not found or unauthorized' 
            });
        }

        const updateResult = await pool.query(
            `UPDATE trades SET notes = $1 WHERE "ID" = $2 AND user_id = $3 RETURNING "ID", symbol`,
            [notes, tradeId, userId]
        );

        const updatedTrade = updateResult.rows[0];
        
        console.log("✅ TRADE NOTE UPDATED SUCCESSFULLY");
        res.json({ 
            success: true, 
            message: 'Trade notes updated!',
            tradeId: updatedTrade?.ID,
            symbol: updatedTrade?.symbol
        });

    } catch (error) {
        console.log("❌ Update Trade Note Error:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// GET TRADE WITH SCREENSHOTS
router.get('/trade-with-screenshots/:tradeId', async (req, res) => {
    const tradeId = req.params.tradeId;
    const userId = req.headers['user-id'] || req.query.userId;

    console.log("📷 GET TRADE WITH SCREENSHOTS - Trade ID:", tradeId, "User ID:", userId);

    if (!tradeId || !userId) {
        return res.json({ 
            success: false, 
            error: 'Trade ID and User ID required' 
        });
    }

    try {
        const result = await pool.query(
            `SELECT * FROM trades WHERE "ID" = $1 AND user_id = $2`,
            [tradeId, userId]
        );

        if (result.rows.length === 0) {
            return res.json({ 
                success: false, 
                error: 'Trade not found or unauthorized' 
            });
        }

        const trade = result.rows[0];
        
        let screenshots = [];
        if (trade.screenshots) {
            try {
                screenshots = Array.isArray(trade.screenshots) 
                    ? trade.screenshots 
                    : JSON.parse(trade.screenshots);
            } catch (e) {
                console.log("⚠️ Could not parse screenshots");
                screenshots = [];
            }
        }
        
        console.log("✅ TRADE WITH SCREENSHOTS FETCHED - Screenshot count:", screenshots.length);
        
        res.json({
            success: true,
            trade: {
                ...trade,
                screenshots: screenshots,
                screenshotCount: screenshots.length
            }
        });

    } catch (error) {
        console.log("❌ Get Trade With Screenshots Error:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== MT5 CREDENTIALS ROUTES ==================== //

// 1. SAVE MT5 CREDENTIALS
router.post('/save-mt5-credentials', async (req, res) => {
    try {
        const { user_id, broker_name, account_id, server_name, investor_password } = req.body;

        console.log("💾 SAVE MT5 CREDENTIALS:", { user_id, account_id });

        // Validation
        if (!user_id || !broker_name || !account_id || !server_name || !investor_password) {
            return res.json({ 
                success: false, 
                error: "All fields required" 
            });
        }

        // Save to database
        await pool.query(
            `INSERT INTO mt5_accounts 
             (user_id, broker_name, account_id, server_name, investor_password, connection_status) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [user_id, broker_name, account_id, server_name, investor_password, 'disconnected']
        );

        console.log("✅ MT5 CREDENTIALS SAVED");
        
        res.json({ 
            success: true, 
            message: 'MT5 credentials saved successfully!'
        });

    } catch (error) {
        console.log("❌ Save MT5 Error:", error.message);
        
        if (error.message.includes('duplicate') || error.message.includes('unique')) {
            return res.json({ 
                success: false, 
                error: "This MT5 account already exists" 
            });
        }
        
        res.json({ success: false, error: error.message });
    }
});

// 2. TEST MT5 CONNECTION
router.post('/test-mt5-connection', async (req, res) => {
    try {
        const { user_id, account_id, investor_password } = req.body;

        console.log("🔗 TEST MT5 CONNECTION:", { account_id });

        if (!user_id || !account_id || !investor_password) {
            return res.json({ 
                success: false, 
                error: "Required fields missing" 
            });
        }

        // Check if account exists
        const result = await pool.query(
            "SELECT * FROM mt5_accounts WHERE user_id = $1 AND account_id = $2",
            [user_id, account_id]
        );

        if (result.rows.length === 0) {
            return res.json({ 
                success: false, 
                error: "MT5 account not found. Save credentials first." 
            });
        }

        const storedAccount = result.rows[0];

        // Simple password check (temporary - bcrypt baad mein)
        if (investor_password !== storedAccount.investor_password) {
            return res.json({ 
                success: false, 
                error: "Invalid investor password" 
            });
        }

        // Update connection status
        await pool.query(
            "UPDATE mt5_accounts SET connection_status = $1, last_connected = $2 WHERE id = $3",
            ['connected', new Date(), storedAccount.id]
        );

        console.log("✅ MT5 CONNECTION SUCCESS");
        
        res.json({ 
            success: true, 
            message: 'Connected to MT5 successfully!'
        });

    } catch (error) {
        console.log("❌ MT5 Connection Error:", error.message);
        res.json({ success: false, error: error.message });
    }
});

module.exports = router;