const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const cloudinary = require('../config/cloudinary');
const upload = require('../config/multer');
const fs = require('fs');

// UPLOAD SCREENSHOT TO CLOUDINARY
router.post('/upload-screenshot', upload.single('screenshot'), async (req, res) => {
    console.log("📸 UPLOAD SCREENSHOT TO CLOUDINARY");
    
    try {
        if (!req.file) {
            return res.json({ 
                success: false, 
                error: 'No file uploaded' 
            });
        }

        const { tradeId, userId } = req.body;
        console.log("Trade ID:", tradeId, "User ID:", userId, "File:", req.file.originalname);

        if (!tradeId || !userId) {
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.json({ 
                success: false, 
                error: 'Trade ID and User ID required' 
            });
        }

        const checkResult = await pool.query(
            `SELECT * FROM trades WHERE "ID" = $1 AND user_id = $2`,
            [tradeId, userId]
        );

        if (checkResult.rows.length === 0) {
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.json({ 
                success: false, 
                error: 'Trade not found or unauthorized' 
            });
        }

        console.log("Uploading to Cloudinary...");
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
            folder: `trading-app/user_${userId}`,
            public_id: `trade_${tradeId}_${Date.now()}`,
            overwrite: false
        });

        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        const trade = checkResult.rows[0];
        let existingScreenshots = [];
        
        if (trade.screenshots) {
            try {
                existingScreenshots = Array.isArray(trade.screenshots) 
                    ? trade.screenshots 
                    : JSON.parse(trade.screenshots);
            } catch (e) {
                console.log("⚠️ Could not parse existing screenshots, starting fresh");
                existingScreenshots = [];
            }
        }

        const newScreenshotUrl = uploadResult.secure_url;
        existingScreenshots.push(newScreenshotUrl);

        const updateResult = await pool.query(
            `UPDATE trades SET screenshots = $1 WHERE "ID" = $2 AND user_id = $3 
             RETURNING "ID", symbol`,
            [JSON.stringify(existingScreenshots), tradeId, userId]
        );

        const updatedTrade = updateResult.rows[0];
        
        console.log("✅ SCREENSHOT UPLOADED TO CLOUDINARY");
        
        res.json({
            success: true,
            message: 'Screenshot uploaded successfully!',
            screenshotUrl: newScreenshotUrl,
            tradeId: updatedTrade?.ID,
            symbol: updatedTrade?.symbol,
            screenshotCount: existingScreenshots.length,
            screenshots: existingScreenshots
        });

    } catch (error) {
        console.log("❌ Screenshot Upload Error:", error.message);
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// DELETE SCREENSHOT FROM CLOUDINARY
router.delete('/trade-screenshot', async (req, res) => {
    const { tradeId, screenshotUrl, userId } = req.body;

    console.log("🗑️ DELETE SCREENSHOT FROM CLOUDINARY");

    if (!tradeId || !screenshotUrl || !userId) {
        return res.json({ 
            success: false, 
            error: 'Trade ID, Screenshot URL and User ID required' 
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

        const currentTrade = checkResult.rows[0];
        let existingScreenshots = [];
        
        if (currentTrade.screenshots) {
            try {
                existingScreenshots = Array.isArray(currentTrade.screenshots) 
                    ? currentTrade.screenshots 
                    : JSON.parse(currentTrade.screenshots);
            } catch (e) {
                console.log("⚠️ Could not parse existing screenshots");
                return res.json({ 
                    success: false, 
                    error: 'Invalid screenshots data format' 
                });
            }
        }

        if (!existingScreenshots.includes(screenshotUrl)) {
            return res.json({ 
                success: false, 
                error: 'Screenshot not found for this trade' 
            });
        }

        if (screenshotUrl.includes('cloudinary.com')) {
            try {
                const urlParts = screenshotUrl.split('/');
                const uploadIndex = urlParts.indexOf('upload');
                if (uploadIndex !== -1) {
                    const publicIdParts = urlParts.slice(uploadIndex + 2);
                    const publicId = publicIdParts.join('/').replace(/\.[^/.]+$/, "");
                    
                    console.log("Deleting from Cloudinary, public_id:", publicId);
                    await cloudinary.uploader.destroy(publicId);
                    console.log("✅ Deleted from Cloudinary");
                }
            } catch (cloudinaryError) {
                console.log("⚠️ Could not delete from Cloudinary:", cloudinaryError.message);
            }
        }

        const updatedScreenshots = existingScreenshots.filter(url => url !== screenshotUrl);
        
        const updateResult = await pool.query(
            `UPDATE trades SET screenshots = $1 WHERE "ID" = $2 AND user_id = $3 
             RETURNING "ID", symbol`,
            [JSON.stringify(updatedScreenshots), tradeId, userId]
        );

        const updatedTrade = updateResult.rows[0];
        
        console.log("✅ SCREENSHOT DELETED SUCCESSFULLY");
        res.json({ 
            success: true, 
            message: 'Screenshot deleted successfully!',
            tradeId: updatedTrade?.ID,
            symbol: updatedTrade?.symbol,
            deletedScreenshot: screenshotUrl,
            remainingScreenshotCount: updatedScreenshots.length,
            screenshots: updatedScreenshots
        });

    } catch (error) {
        console.log("❌ Delete Screenshot Error:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// UPDATE TRADE SCREENSHOTS
router.post('/update-trade-screenshots', async (req, res) => {
    const { tradeId, screenshots, userId, action = 'add' } = req.body;

    console.log("📸 UPDATE TRADE SCREENSHOTS - Trade ID:", tradeId, "Action:", action, "Screenshots:", screenshots?.length || 0);

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

        const currentTrade = checkResult.rows[0];
        let existingScreenshots = [];
        
        if (currentTrade.screenshots) {
            try {
                existingScreenshots = Array.isArray(currentTrade.screenshots) 
                    ? currentTrade.screenshots 
                    : JSON.parse(currentTrade.screenshots);
            } catch (e) {
                console.log("⚠️ Could not parse existing screenshots, starting fresh");
                existingScreenshots = [];
            }
        }

        let updatedScreenshots = [];
        
        if (action === 'add' && screenshots) {
            const newScreenshots = Array.isArray(screenshots) ? screenshots : [screenshots];
            updatedScreenshots = [...existingScreenshots, ...newScreenshots];
            console.log(`➕ ADDED ${newScreenshots.length} screenshots. Total: ${updatedScreenshots.length}`);
            
        } else if (action === 'replace' && screenshots) {
            updatedScreenshots = Array.isArray(screenshots) ? screenshots : [screenshots];
            console.log(`🔄 REPLACED all screenshots. New count: ${updatedScreenshots.length}`);
            
        } else if (action === 'delete' && screenshots) {
            const screenshotsToDelete = Array.isArray(screenshots) ? screenshots : [screenshots];
            updatedScreenshots = existingScreenshots.filter(screenshot => 
                !screenshotsToDelete.includes(screenshot)
            );
            console.log(`🗑️ DELETED ${screenshotsToDelete.length} screenshots. Remaining: ${updatedScreenshots.length}`);
            
        } else if (action === 'clear') {
            updatedScreenshots = [];
            console.log("🧹 CLEARED all screenshots");
            
        } else {
            return res.json({ 
                success: false, 
                error: 'Invalid action or screenshots data' 
            });
        }

        const updateResult = await pool.query(
            `UPDATE trades SET screenshots = $1 WHERE "ID" = $2 AND user_id = $3 RETURNING "ID", symbol`,
            [JSON.stringify(updatedScreenshots), tradeId, userId]
        );

        const updatedTrade = updateResult.rows[0];
        
        console.log("✅ TRADE SCREENSHOTS UPDATED SUCCESSFULLY");
        res.json({ 
            success: true, 
            message: `Trade screenshots ${action}ed successfully!`,
            tradeId: updatedTrade?.ID,
            symbol: updatedTrade?.symbol,
            screenshotCount: updatedScreenshots.length,
            screenshots: updatedScreenshots
        });

    } catch (error) {
        console.log("❌ Update Trade Screenshots Error:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== API TRADES SCREENSHOTS & NOTES ====================

// UPLOAD API TRADE SCREENSHOT
router.post('/upload-api-screenshot', upload.single('screenshot'), async (req, res) => {
    console.log("📸 UPLOAD API TRADE SCREENSHOT");
    
    try {
        if (!req.file) {
            return res.json({ 
                success: false, 
                error: 'No file uploaded' 
            });
        }

        const { ticket, userId } = req.body;
        console.log("Ticket:", ticket, "User ID:", userId, "File:", req.file.originalname);

        if (!ticket || !userId) {
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.json({ 
                success: false, 
                error: 'Ticket and User ID required' 
            });
        }

        // Check if API trade exists
        const checkResult = await pool.query(
            `SELECT * FROM api_trades WHERE ticket = $1 AND user_id = $2`,
            [ticket, userId]
        );

        if (checkResult.rows.length === 0) {
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.json({ 
                success: false, 
                error: 'API Trade not found or unauthorized' 
            });
        }

        console.log("Uploading to Cloudinary...");
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
            folder: `api-trades/user_${userId}`,
            public_id: `ticket_${ticket}_${Date.now()}`,
            overwrite: false
        });

        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        const trade = checkResult.rows[0];
        let existingScreenshots = [];
        
        if (trade.screenshots) {
            try {
                existingScreenshots = Array.isArray(trade.screenshots) 
                    ? trade.screenshots 
                    : JSON.parse(trade.screenshots);
            } catch (e) {
                console.log("⚠️ Could not parse existing screenshots, starting fresh");
                existingScreenshots = [];
            }
        }

        const newScreenshotUrl = uploadResult.secure_url;
        existingScreenshots.push(newScreenshotUrl);

        const updateResult = await pool.query(
            `UPDATE api_trades SET screenshots = $1 WHERE ticket = $2 AND user_id = $3 
             RETURNING ticket, symbol`,
            [JSON.stringify(existingScreenshots), ticket, userId]
        );

        const updatedTrade = updateResult.rows[0];
        
        console.log("✅ API TRADE SCREENSHOT UPLOADED TO CLOUDINARY");
        
        res.json({
            success: true,
            message: 'API trade screenshot uploaded successfully!',
            screenshotUrl: newScreenshotUrl,
            ticket: updatedTrade?.ticket,
            symbol: updatedTrade?.symbol,
            screenshotCount: existingScreenshots.length,
            screenshots: existingScreenshots
        });

    } catch (error) {
        console.log("❌ API Trade Screenshot Upload Error:", error.message);
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// DELETE API TRADE SCREENSHOT
router.delete('/api-trade-screenshot', async (req, res) => {
    const { ticket, screenshotUrl, userId } = req.body;

    console.log("🗑️ DELETE API TRADE SCREENSHOT");

    if (!ticket || !screenshotUrl || !userId) {
        return res.json({ 
            success: false, 
            error: 'Ticket, Screenshot URL and User ID required' 
        });
    }

    try {
        const checkResult = await pool.query(
            `SELECT * FROM api_trades WHERE ticket = $1 AND user_id = $2`,
            [ticket, userId]
        );

        if (checkResult.rows.length === 0) {
            return res.json({ 
                success: false, 
                error: 'API Trade not found or unauthorized' 
            });
        }

        const currentTrade = checkResult.rows[0];
        let existingScreenshots = [];
        
        if (currentTrade.screenshots) {
            try {
                existingScreenshots = Array.isArray(currentTrade.screenshots) 
                    ? currentTrade.screenshots 
                    : JSON.parse(currentTrade.screenshots);
            } catch (e) {
                console.log("⚠️ Could not parse existing screenshots");
                return res.json({ 
                    success: false, 
                    error: 'Invalid screenshots data format' 
                });
            }
        }

        if (!existingScreenshots.includes(screenshotUrl)) {
            return res.json({ 
                success: false, 
                error: 'Screenshot not found for this trade' 
            });
        }

        if (screenshotUrl.includes('cloudinary.com')) {
            try {
                const urlParts = screenshotUrl.split('/');
                const uploadIndex = urlParts.indexOf('upload');
                if (uploadIndex !== -1) {
                    const publicIdParts = urlParts.slice(uploadIndex + 2);
                    const publicId = publicIdParts.join('/').replace(/\.[^/.]+$/, "");
                    
                    console.log("Deleting from Cloudinary, public_id:", publicId);
                    await cloudinary.uploader.destroy(publicId);
                    console.log("✅ Deleted from Cloudinary");
                }
            } catch (cloudinaryError) {
                console.log("⚠️ Could not delete from Cloudinary:", cloudinaryError.message);
            }
        }

        const updatedScreenshots = existingScreenshots.filter(url => url !== screenshotUrl);
        
        const updateResult = await pool.query(
            `UPDATE api_trades SET screenshots = $1 WHERE ticket = $2 AND user_id = $3 
             RETURNING ticket, symbol`,
            [JSON.stringify(updatedScreenshots), ticket, userId]
        );

        const updatedTrade = updateResult.rows[0];
        
        console.log("✅ API TRADE SCREENSHOT DELETED SUCCESSFULLY");
        res.json({ 
            success: true, 
            message: 'API trade screenshot deleted successfully!',
            ticket: updatedTrade?.ticket,
            symbol: updatedTrade?.symbol,
            deletedScreenshot: screenshotUrl,
            remainingScreenshotCount: updatedScreenshots.length,
            screenshots: updatedScreenshots
        });

    } catch (error) {
        console.log("❌ Delete API Trade Screenshot Error:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// UPDATE API TRADE NOTE
router.post('/update-api-trade-note', async (req, res) => {
    const { ticket, notes, userId } = req.body;

    console.log("📝 UPDATE API TRADE NOTE - Ticket:", ticket, "User ID:", userId);

    if (!ticket || !userId) {
        return res.json({ 
            success: false, 
            error: 'Ticket and User ID required' 
        });
    }

    try {
        const checkResult = await pool.query(
            `SELECT * FROM api_trades WHERE ticket = $1 AND user_id = $2`,
            [ticket, userId]
        );

        if (checkResult.rows.length === 0) {
            return res.json({ 
                success: false, 
                error: 'API Trade not found or unauthorized' 
            });
        }

        const updateResult = await pool.query(
            `UPDATE api_trades SET notes = $1 WHERE ticket = $2 AND user_id = $3 
             RETURNING ticket, symbol`,
            [notes, ticket, userId]
        );

        const updatedTrade = updateResult.rows[0];
        
        console.log("✅ API TRADE NOTE UPDATED SUCCESSFULLY");
        res.json({ 
            success: true, 
            message: 'API trade note updated!',
            ticket: updatedTrade?.ticket,
            symbol: updatedTrade?.symbol
        });

    } catch (error) {
        console.log("❌ Update API Trade Note Error:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== STRATEGY ROUTES ====================

// UPDATE MANUAL TRADE STRATEGY
router.post('/update-trade-strategy', async (req, res) => {
    const { tradeId, strategy, userId } = req.body;

    console.log("🎯 UPDATE MANUAL TRADE STRATEGY - Trade ID:", tradeId, "User ID:", userId);

    if (!tradeId || !userId) {
        return res.json({ 
            success: false, 
            error: 'Trade ID and User ID required' 
        });
    }

    try {
        // Check if trade exists and belongs to user
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

        // Update strategy
        const updateResult = await pool.query(
            `UPDATE trades SET strategy = $1 WHERE "ID" = $2 AND user_id = $3 
             RETURNING "ID", symbol, strategy`,
            [strategy, tradeId, userId]
        );

        const updatedTrade = updateResult.rows[0];
        
        console.log("✅ MANUAL TRADE STRATEGY UPDATED SUCCESSFULLY");
        console.log("Updated Trade:", {
            id: updatedTrade?.ID,
            symbol: updatedTrade?.symbol,
            strategy: updatedTrade?.strategy?.substring(0, 50) + '...'
        });
        
        res.json({ 
            success: true, 
            message: 'Trade strategy updated successfully!',
            tradeId: updatedTrade?.ID,
            symbol: updatedTrade?.symbol,
            strategy: updatedTrade?.strategy
        });

    } catch (error) {
        console.log("❌ Update Trade Strategy Error:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// UPDATE API TRADE STRATEGY
router.post('/update-api-trade-strategy', async (req, res) => {
    const { ticket, strategy, userId } = req.body;

    console.log("🎯 UPDATE API TRADE STRATEGY - Ticket:", ticket, "User ID:", userId);

    if (!ticket || !userId) {
        return res.json({ 
            success: false, 
            error: 'Ticket and User ID required' 
        });
    }

    try {
        // Check if API trade exists and belongs to user
        const checkResult = await pool.query(
            `SELECT * FROM api_trades WHERE ticket = $1 AND user_id = $2`,
            [ticket, userId]
        );

        if (checkResult.rows.length === 0) {
            return res.json({ 
                success: false, 
                error: 'API Trade not found or unauthorized' 
            });
        }

        // Update strategy
        const updateResult = await pool.query(
            `UPDATE api_trades SET strategy = $1 WHERE ticket = $2 AND user_id = $3 
             RETURNING ticket, symbol, strategy`,
            [strategy, ticket, userId]
        );

        const updatedTrade = updateResult.rows[0];
        
        console.log("✅ API TRADE STRATEGY UPDATED SUCCESSFULLY");
        console.log("Updated API Trade:", {
            ticket: updatedTrade?.ticket,
            symbol: updatedTrade?.symbol,
            strategy: updatedTrade?.strategy?.substring(0, 50) + '...'
        });
        
        res.json({ 
            success: true, 
            message: 'API trade strategy updated successfully!',
            ticket: updatedTrade?.ticket,
            symbol: updatedTrade?.symbol,
            strategy: updatedTrade?.strategy
        });

    } catch (error) {
        console.log("❌ Update API Trade Strategy Error:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router;


