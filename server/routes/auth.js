const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// AUTH CHECK MIDDLEWARE
const authCheck = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ 
                success: false, 
                error: 'Access token required',
                logout: true 
            });
        }
        
        const token = authHeader.split(' ')[1];
        
        // Verify JWT token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Check if user exists and NOT deleted
        const userResult = await pool.query(
            `SELECT "ID" FROM public."user" WHERE "ID" = $1 AND "isDeleted" = false`,
            [decoded.userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'Account deleted or not found',
                logout: true 
            });
        }
        
        req.userId = decoded.userId;
        next();
        
    } catch (error) {
        console.error('Auth error:', error.message);
        return res.status(401).json({ 
            success: false, 
            error: 'Invalid or expired token',
            logout: true 
        });
    }
};

// REGISTER
router.post('/register', async (req, res) => {
    const { firstName, lastName, email, phone, password, preferred_currency = 'USD' } = req.body;

    console.log("💰 REGISTER:", { firstName, email, preferred_currency });

    try {
        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const result = await pool.query(
            `INSERT INTO public."user" (
                "firstName",
                "lastName",
                "email", 
                "phone",
                "password",
                "preferred_currency",
                "isDeleted"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [firstName, lastName, email, phone, hashedPassword, preferred_currency, false]
        );

        const newUser = result.rows[0];
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: newUser.ID, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({ 
            success: true, 
            message: 'User registered successfully!',
            token: token,
            user: {
                ID: newUser.ID,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                email: newUser.email,
                phone: newUser.phone,
                preferred_currency: newUser.preferred_currency || 'USD'
            }
        });

    } catch (error) {
        console.log("❌ DB Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// LOGIN
router.post('/login', async (req, res) => {
    const { email, phone, password } = req.body;

    console.log("🔍 LOGIN ATTEMPT:", { email, phone });

    try {
        let query = '';
        let values = [];

        if (email && email.trim() !== '') {
            query = `SELECT * FROM public."user" WHERE "email" = $1 AND "isDeleted" = false`;
            values = [email];
        } else if (phone && phone.trim() !== '') {
            query = `SELECT * FROM public."user" WHERE "phone" = $1 AND "isDeleted" = false`;
            values = [phone];
        } else {
            return res.status(400).json({ 
                success: false, 
                error: "Please enter email or phone" 
            });
        }

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: "User not found or account deleted" 
            });
        }

        const user = result.rows[0];

        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
            return res.status(401).json({ 
                success: false, 
                error: "Invalid password" 
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.ID, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log("✅ LOGIN SUCCESSFUL");
        res.json({
            success: true,
            token: token,
            user: {
                ID: user.ID,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phone: user.phone,
                accountType: user.accountType || 'manual',
                preferred_currency: user.preferred_currency || 'USD'
            }
        });

    } catch (error) {
        console.log("❌ Login Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// UPDATE PROFILE
router.post('/update-profile', authCheck, async (req, res) => {
    const userId = req.userId;
    const { firstName, lastName, email, phone, password, preferred_currency } = req.body;

    console.log("👤 UPDATE PROFILE - Authenticated User ID:", userId);

    // Validate password if provided
    if (password && password.trim().length < 6) {
        return res.status(400).json({ 
            success: false, 
            error: 'Password must be at least 6 characters long' 
        });
    }

    try {
        // Get current user
        const currentUserResult = await pool.query(
            `SELECT * FROM public."user" WHERE "ID" = $1 AND "isDeleted" = false`,
            [userId]
        );

        if (currentUserResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const currentUser = currentUserResult.rows[0];

        // Check email duplicate
        if (email && email !== currentUser.email) {
            const emailCheck = await pool.query(
                `SELECT "ID" FROM public."user" WHERE "email" = $1 AND "ID" != $2 AND "isDeleted" = false`,
                [email, userId]
            );
            
            if (emailCheck.rows.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Email already exists' 
                });
            }
        }

        // Check phone duplicate
        if (phone && phone !== currentUser.phone) {
            const phoneCheck = await pool.query(
                `SELECT "ID" FROM public."user" WHERE "phone" = $1 AND "ID" != $2 AND "isDeleted" = false`,
                [phone, userId]
            );
            
            if (phoneCheck.rows.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Phone number already exists' 
                });
            }
        }

        // Hash password if provided
        let hashedPassword = null;
        if (password) {
            const saltRounds = 10;
            hashedPassword = await bcrypt.hash(password.trim(), saltRounds);
        }

        const formattedCurrency = preferred_currency ? 
            (typeof preferred_currency === 'string' ? preferred_currency.toUpperCase() : preferred_currency) 
            : null;

        const result = await pool.query(
            `UPDATE public."user" SET 
                "firstName" = COALESCE($1, "firstName"),
                "lastName" = COALESCE($2, "lastName"),
                "email" = COALESCE($3, "email"),
                "phone" = COALESCE($4, "phone"),
                "password" = COALESCE($5, "password"),
                "preferred_currency" = COALESCE($6, "preferred_currency")
             WHERE "ID" = $7 AND "isDeleted" = false RETURNING *`,
            [
                firstName || null, 
                lastName || null, 
                email || null, 
                phone || null, 
                hashedPassword || null, 
                formattedCurrency || null,
                userId
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const updatedUser = result.rows[0];
        
        console.log("✅ PROFILE UPDATED SUCCESSFULLY");
        
        let updateMessage = 'Profile updated!';
        if (password) updateMessage += ' Password updated.';
        if (preferred_currency) updateMessage += ` Currency updated to ${updatedUser.preferred_currency}.`;
        
        res.json({
            success: true,
            message: updateMessage,
            user: {
                ID: updatedUser.ID,
                firstName: updatedUser.firstName,
                lastName: updatedUser.lastName,
                email: updatedUser.email,
                phone: updatedUser.phone,
                accountType: updatedUser.accountType || 'manual',
                preferred_currency: updatedUser.preferred_currency || 'USD'
            }
        });

    } catch (error) {
        console.log("❌ Update Profile Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET USER PROFILE (PROTECTED)
router.get('/user-profile', authCheck, async (req, res) => {
    const userId = req.userId;

    console.log("👤 GET USER PROFILE - Authenticated User ID:", userId);

    try {
        const result = await pool.query(
            `SELECT "ID", "firstName", "lastName", "email", "phone", 
                    "accountType", "preferred_currency", "createdAt"
             FROM public."user" 
             WHERE "ID" = $1 AND "isDeleted" = false`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const user = result.rows[0];
        
        console.log("✅ USER PROFILE FETCHED");
        res.json({
            success: true,
            user: {
                ID: user.ID,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phone: user.phone,
                accountType: user.accountType || 'manual',
                preferred_currency: user.preferred_currency || 'USD',
                createdAt: user.createdAt
            }
        });

    } catch (error) {
        console.log("❌ Get User Profile Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// UPDATE CURRENCY (PROTECTED)
router.post('/update-currency', authCheck, async (req, res) => {
    const { currency } = req.body;
    const userId = req.userId;

    console.log("💰 UPDATE CURRENCY - User:", userId, "Currency:", currency);

    if (!currency) {
        return res.status(400).json({ success: false, error: 'currency required' });
    }

    try {
        const formattedCurrency = typeof currency === 'string' ? currency.toUpperCase() : currency;
        
        const result = await pool.query(
            `UPDATE public."user" 
             SET preferred_currency = $1 
             WHERE "ID" = $2 AND "isDeleted" = false 
             RETURNING *`,
            [formattedCurrency, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const updatedUser = result.rows[0];
        
        console.log("✅ CURRENCY UPDATED SUCCESSFULLY");
        res.json({
            success: true,
            message: 'Currency preference updated!',
            user: {
                ID: updatedUser.ID,
                firstName: updatedUser.firstName,
                lastName: updatedUser.lastName,
                email: updatedUser.email,
                preferred_currency: updatedUser.preferred_currency
            }
        });

    } catch (error) {
        console.log("❌ Update Currency Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE USER ACCOUNT (PROTECTED) - SIMPLE VERSION
router.delete('/delete-account', authCheck, async (req, res) => {
    const userId = req.userId;
    const { password } = req.body;

    console.log("🗑️ DELETE ACCOUNT REQUEST - User ID:", userId);

    if (!password) {
        return res.status(400).json({ 
            success: false, 
            error: 'Password is required' 
        });
    }

    try {
        // Get user with password
        const userResult = await pool.query(
            `SELECT * FROM public."user" WHERE "ID" = $1 AND "isDeleted" = false`,
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        const user = userResult.rows[0];
        
        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
            return res.status(401).json({ 
                success: false, 
                error: "Invalid password" 
            });
        }

        // ✅ SIMPLE SOFT DELETE - ONLY isDeleted = true
        await pool.query(
            `UPDATE public."user" 
             SET "isDeleted" = true 
             WHERE "ID" = $1`,
            [userId]
        );

        console.log("✅ ACCOUNT DELETED SUCCESSFULLY");
        
        res.json({
            success: true,
            message: 'Account deleted successfully. Contact admin to restore.'
        });

    } catch (error) {
        console.log("❌ Delete Account Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// LOGOUT (Optional)
router.post('/logout', authCheck, (req, res) => {
    console.log("🚪 LOGOUT - User ID:", req.userId);
    
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// ADMIN RESTORE ROUTE (Optional - Add if needed)
router.post('/admin/restore-user/:userId', async (req, res) => {
    const { userId } = req.params;
    const { adminSecret } = req.body;
    
    // Simple admin check
    if (adminSecret !== process.env.ADMIN_SECRET) {
        return res.status(403).json({ error: 'Admin access only' });
    }
    
    try {
        await pool.query(
            `UPDATE public."user" SET "isDeleted" = false WHERE "ID" = $1`,
            [userId]
        );
        
        res.json({ 
            success: true, 
            message: 'User account restored' 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;