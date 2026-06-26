const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
require('dotenv').config();

const app = express();
const path = require('path');

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// Serve static files from the parent directory
app.use(express.static(path.join(__dirname, '..')));

// Make the main app available at the root URL.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'exp.html'));
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'UP', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'mednifi_dev_secret_change_me';
const LOW_STOCK_THRESHOLD = 20;

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// --- AUTH ROUTES ---

app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, pharmacy_name } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email and password are required' });
        }

        const [existingUsers] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const pharmacyName = (pharmacy_name || name || '').trim();
        if (!pharmacyName) {
            return res.status(400).json({ error: 'Pharmacy name is required' });
        }

        const [pharmacyResult] = await db.query(
            'INSERT INTO pharmacy (name, city) VALUES (?, ?)',
            [pharmacyName, 'Unknown']
        );

        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (pharmacy_id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [pharmacyResult.insertId, name, email, hashedPassword, 'owner']
        );

        res.status(201).json({ message: 'Pharmacy and user registered successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    console.log('Login attempt for:', req.body.email);
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const [users] = await db.query(
            `SELECT u.*, p.name AS pharmacy_name
             FROM users u
             INNER JOIN pharmacy p ON p.id = u.pharmacy_id
             WHERE u.email = ?`,
            [email]
        );
        if (users.length === 0) {
            console.log('Login failed: User not found');
            return res.status(400).json({ error: 'User not found' });
        }

        const user = users[0];
        let validPassword = false;
        const storedPassword = user.password || '';

        if (storedPassword.startsWith('$2')) {
            validPassword = await bcrypt.compare(password, storedPassword);
        } else {
            // Backward compatibility for old plain-text rows, then migrate to hash.
            validPassword = password === storedPassword;
            if (validPassword) {
                const upgradedHash = await bcrypt.hash(password, 10);
                await db.query('UPDATE users SET password = ? WHERE id = ?', [upgradedHash, user.id]);
            }
        }

        if (!validPassword) {
            console.log('Login failed: Invalid password');
            return res.status(400).json({ error: 'Invalid password' });
        }

        const token = jwt.sign(
            { id: user.id, name: user.name, pharmacy_id: user.pharmacy_id },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        console.log('Login successful for:', user.name);
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                pharmacy_id: user.pharmacy_id,
                pharmacy_name: user.pharmacy_name
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// --- MEDICINE ROUTES ---

// Add Medicine
app.post('/api/medicines', authenticateToken, async (req, res) => {
    console.log('Adding medicine:', req.body);
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const { name, batch_number, stock_quantity, expiry_date, price_per_unit } = req.body;
        
        if (!name || !batch_number || !expiry_date) {
            return res.status(400).json({ error: 'Name, batch number and expiry date are required' });
        }

        const quantity = Number(stock_quantity);
        const price = Number(price_per_unit);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return res.status(400).json({ error: 'Stock quantity must be a positive number' });
        }
        if (!Number.isFinite(price) || price <= 0) {
            return res.status(400).json({ error: 'Price per unit must be a positive number' });
        }

        const [medicines] = await connection.query(
            'SELECT id FROM medicine WHERE pharmacy_id = ? AND name = ? LIMIT 1',
            [req.user.pharmacy_id, name]
        );

        let medicineId = medicines[0] ? medicines[0].id : null;
        if (!medicineId) {
            const [insertMedicine] = await connection.query(
                'INSERT INTO medicine (pharmacy_id, name) VALUES (?, ?)',
                [req.user.pharmacy_id, name]
            );
            medicineId = insertMedicine.insertId;
        }

        await connection.query(
            'INSERT INTO stock (pharmacy_id, medicine_id, batch_number, quantity, expiry_date, price_per_unit, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.user.pharmacy_id, medicineId, batch_number, quantity, expiry_date, price, req.user.id]
        );

        await refreshAlertsForPharmacy(connection, req.user.pharmacy_id);
        await connection.commit();
        res.status(201).json({ message: 'Medicine added successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Error saving medicine:', error);
        res.status(500).json({ error: 'Database error: ' + error.message });
    } finally {
        connection.release();
    }
});

// Get All Medicines for User
app.get('/api/medicines', authenticateToken, async (req, res) => {
    try {
        const [medicines] = await db.query(
            `SELECT
                s.id,
                m.name,
                s.batch_number,
                s.quantity AS stock_quantity,
                s.expiry_date,
                s.price_per_unit,
                s.created_at
             FROM stock s
             INNER JOIN medicine m ON m.id = s.medicine_id
             WHERE s.pharmacy_id = ?
             ORDER BY s.created_at DESC, s.id DESC`,
            [req.user.pharmacy_id]
        );
        res.json(medicines);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Sell/Remove Medicine (Records as Sale)
app.post('/api/medicines/sell', authenticateToken, async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const { medicine_id, quantity } = req.body;

        // 1. Get medicine details
        const [stockRows] = await connection.query(
            `SELECT s.*, m.name AS medicine_name
             FROM stock s
             INNER JOIN medicine m ON m.id = s.medicine_id
             WHERE s.id = ? AND s.pharmacy_id = ?`,
            [medicine_id, req.user.pharmacy_id]
        );
        if (stockRows.length === 0) throw new Error('Medicine batch not found');
        const stockItem = stockRows[0];

        const requestedQty = Number(quantity);
        if (!Number.isFinite(requestedQty) || requestedQty <= 0) throw new Error('Invalid quantity');
        if (stockItem.quantity < requestedQty) throw new Error('Insufficient stock');

        // 2. Update stock
        const newStock = stockItem.quantity - requestedQty;
        if (newStock === 0) {
            await connection.query('DELETE FROM stock WHERE id = ?', [medicine_id]);
        } else {
            await connection.query('UPDATE stock SET quantity = ? WHERE id = ?', [newStock, medicine_id]);
        }

        // 3. Record Sale
        await connection.query(
            'INSERT INTO sale (pharmacy_id, stock_id, medicine_id, sold_by, quantity_sold, sale_price) VALUES (?, ?, ?, ?, ?, ?)',
            [req.user.pharmacy_id, stockItem.id, stockItem.medicine_id, req.user.id, requestedQty, stockItem.price_per_unit * requestedQty]
        );

        await refreshAlertsForPharmacy(connection, req.user.pharmacy_id);
        await connection.commit();
        res.json({ message: 'Sale recorded and stock updated' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

// Delete Medicine Batch
app.delete('/api/medicines/:stockId', authenticateToken, async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const stockId = Number(req.params.stockId);
        if (!Number.isFinite(stockId) || stockId <= 0) {
            return res.status(400).json({ error: 'Invalid stock id' });
        }

        const [stockRows] = await connection.query(
            'SELECT id, medicine_id FROM stock WHERE id = ? AND pharmacy_id = ?',
            [stockId, req.user.pharmacy_id]
        );
        if (stockRows.length === 0) {
            return res.status(404).json({ error: 'Medicine batch not found' });
        }

        const medicineId = stockRows[0].medicine_id;
        await connection.query('DELETE FROM stock WHERE id = ? AND pharmacy_id = ?', [stockId, req.user.pharmacy_id]);

        const [remainingStock] = await connection.query(
            'SELECT id FROM stock WHERE pharmacy_id = ? AND medicine_id = ? LIMIT 1',
            [req.user.pharmacy_id, medicineId]
        );
        if (remainingStock.length === 0) {
            await connection.query('DELETE FROM medicine WHERE id = ? AND pharmacy_id = ?', [medicineId, req.user.pharmacy_id]);
        }

        await refreshAlertsForPharmacy(connection, req.user.pharmacy_id);
        await connection.commit();
        res.json({ message: 'Medicine batch deleted successfully' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

// --- ANALYTICS ROUTES ---

app.get('/api/analytics', authenticateToken, async (req, res) => {
    try {
        // Total Revenue
        const [revenue] = await db.query('SELECT SUM(sale_price) as total_revenue FROM sale WHERE pharmacy_id = ?', [req.user.pharmacy_id]);
        
        // Total Stock
        const [stock] = await db.query('SELECT SUM(quantity) as total_items FROM stock WHERE pharmacy_id = ?', [req.user.pharmacy_id]);
        
        // Sales over time (last 7 days)
        const [chartData] = await db.query(
            'SELECT DATE(sale_date) as date, SUM(sale_price) as revenue FROM sale WHERE pharmacy_id = ? AND sale_date >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(sale_date) ORDER BY date ASC',
            [req.user.pharmacy_id]
        );

        // Expiring Soon (next 30 days)
        const [expiring] = await db.query(
            `SELECT
                s.id,
                m.name,
                s.batch_number,
                s.quantity AS stock_quantity,
                s.expiry_date,
                s.price_per_unit
             FROM stock s
             INNER JOIN medicine m ON m.id = s.medicine_id
             WHERE s.pharmacy_id = ?
               AND s.expiry_date >= CURDATE()
               AND s.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
             ORDER BY s.expiry_date ASC`,
            [req.user.pharmacy_id]
        );

        // Low Stock (less than 20 units)
        const [lowStock] = await db.query(
            `SELECT
                s.id,
                m.name,
                s.batch_number,
                s.quantity AS stock_quantity,
                s.expiry_date
             FROM stock s
             INNER JOIN medicine m ON m.id = s.medicine_id
             WHERE s.pharmacy_id = ? AND s.quantity < ?
             ORDER BY s.quantity ASC`,
            [req.user.pharmacy_id, LOW_STOCK_THRESHOLD]
        );

        // Top SKU (most sold medicine)
        const [topSku] = await db.query(
            `SELECT m.name AS medicine_name, SUM(sa.quantity_sold) as total_sold
             FROM sale sa
             INNER JOIN medicine m ON m.id = sa.medicine_id
             WHERE sa.pharmacy_id = ?
               AND sa.sale_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
             GROUP BY m.name
             ORDER BY total_sold DESC
             LIMIT 1`,
            [req.user.pharmacy_id]
        );

        const inventoryHealth = [];
        for (let offset = 0; offset < 7; offset += 1) {
            const [dailyRows] = await db.query(
                `SELECT
                    DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ${offset} DAY), '%a') AS label,
                    COUNT(CASE
                        WHEN s.expiry_date >= DATE_ADD(CURDATE(), INTERVAL ${offset} DAY)
                         AND s.expiry_date <= DATE_ADD(DATE_ADD(CURDATE(), INTERVAL ${offset} DAY), INTERVAL 30 DAY)
                        THEN 1
                    END) AS expiring_count,
                    COUNT(CASE WHEN s.quantity < ? THEN 1 END) AS low_stock_count
                 FROM stock s
                 WHERE s.pharmacy_id = ?`,
                [LOW_STOCK_THRESHOLD, req.user.pharmacy_id]
            );

            inventoryHealth.push({
                label: dailyRows[0].label,
                expiringCount: Number(dailyRows[0].expiring_count || 0),
                lowStockCount: Number(dailyRows[0].low_stock_count || 0)
            });
        }

        res.json({
            totalRevenue: revenue[0].total_revenue || 0,
            totalStock: stock[0].total_items || 0,
            chartData,
            inventoryHealth,
            expiring,
            lowStock,
            topSku: topSku[0] ? topSku[0].medicine_name : 'N/A'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

async function refreshAlertsForPharmacy(connection, pharmacyId) {
    await connection.query('DELETE FROM expiry_alert WHERE pharmacy_id = ?', [pharmacyId]);
    await connection.query('DELETE FROM stock_alert WHERE pharmacy_id = ?', [pharmacyId]);

    await connection.query(
        `INSERT INTO expiry_alert (pharmacy_id, stock_id, message, severity)
         SELECT s.pharmacy_id, s.id, CONCAT(m.name, ' (Batch ', s.batch_number, ') expires on ', DATE_FORMAT(s.expiry_date, '%Y-%m-%d')), 'danger'
         FROM stock s
         INNER JOIN medicine m ON m.id = s.medicine_id
         WHERE s.pharmacy_id = ?
           AND s.expiry_date >= CURDATE()
           AND s.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)`,
        [pharmacyId]
    );

    await connection.query(
        `INSERT INTO stock_alert (pharmacy_id, stock_id, message, severity)
         SELECT s.pharmacy_id, s.id, CONCAT(m.name, ' is low (', s.quantity, ' units left)'), 'warning'
         FROM stock s
         INNER JOIN medicine m ON m.id = s.medicine_id
         WHERE s.pharmacy_id = ? AND s.quantity < ?`,
        [pharmacyId, LOW_STOCK_THRESHOLD]
    );
}

async function startServer() {
    try {
        await db.initDatabase();
        await db.query('SELECT 1');
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log('Database connected successfully');
        });
    } catch (err) {
        console.error('CRITICAL ERROR: Could not connect to the database.');
        console.error('Please check your .env file and ensure MySQL is running.');
        console.error('Error details:', err.message);
        process.exit(1);
    }
}

startServer();
