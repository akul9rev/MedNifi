const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const dbName = process.env.DB_NAME || 'mednifi';

let pool;

async function initDatabase() {
    const bootstrapConn = await mysql.createConnection({
        host: dbConfig.host,    
        user: dbConfig.user,
        password: dbConfig.password
    });

    await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    await bootstrapConn.query(`USE \`${dbName}\``);

    await bootstrapConn.query(`
        CREATE TABLE IF NOT EXISTS pharmacy (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            address VARCHAR(255) NULL,
            city VARCHAR(120) NULL,
            phone VARCHAR(30) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await bootstrapConn.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pharmacy_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(100) DEFAULT 'staff',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pharmacy_id) REFERENCES pharmacy(id) ON DELETE CASCADE
        )
    `);

    await bootstrapConn.query(`
        CREATE TABLE IF NOT EXISTS medicine (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pharmacy_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            category VARCHAR(120) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_medicine_per_pharmacy (pharmacy_id, name),
            FOREIGN KEY (pharmacy_id) REFERENCES pharmacy(id) ON DELETE CASCADE
        )
    `);

    await bootstrapConn.query(`
        CREATE TABLE IF NOT EXISTS stock (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pharmacy_id INT NOT NULL,
            medicine_id INT NOT NULL,
            batch_number VARCHAR(100) NOT NULL,
            quantity INT NOT NULL,
            expiry_date DATE NOT NULL,
            price_per_unit DECIMAL(10, 2) NOT NULL,
            created_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pharmacy_id) REFERENCES pharmacy(id) ON DELETE CASCADE,
            FOREIGN KEY (medicine_id) REFERENCES medicine(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    await bootstrapConn.query(`
        CREATE TABLE IF NOT EXISTS sale (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pharmacy_id INT NOT NULL,
            stock_id INT NULL,
            medicine_id INT NULL,
            sold_by INT NULL,
            quantity_sold INT NOT NULL,
            sale_price DECIMAL(10, 2) NOT NULL,
            sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pharmacy_id) REFERENCES pharmacy(id) ON DELETE CASCADE,
            FOREIGN KEY (stock_id) REFERENCES stock(id) ON DELETE SET NULL,
            FOREIGN KEY (medicine_id) REFERENCES medicine(id) ON DELETE SET NULL,
            FOREIGN KEY (sold_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    await bootstrapConn.query(`
        CREATE TABLE IF NOT EXISTS expiry_alert (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pharmacy_id INT NOT NULL,
            stock_id INT NOT NULL,
            message VARCHAR(255) NOT NULL,
            severity VARCHAR(40) DEFAULT 'warning',
            is_resolved TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pharmacy_id) REFERENCES pharmacy(id) ON DELETE CASCADE,
            FOREIGN KEY (stock_id) REFERENCES stock(id) ON DELETE CASCADE
        )
    `);

    await bootstrapConn.query(`
        CREATE TABLE IF NOT EXISTS stock_alert (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pharmacy_id INT NOT NULL,
            stock_id INT NOT NULL,
            message VARCHAR(255) NOT NULL,
            severity VARCHAR(40) DEFAULT 'warning',
            is_resolved TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pharmacy_id) REFERENCES pharmacy(id) ON DELETE CASCADE,
            FOREIGN KEY (stock_id) REFERENCES stock(id) ON DELETE CASCADE
        )
    `);

    await bootstrapConn.query(`
        CREATE TABLE IF NOT EXISTS suppliers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pharmacy_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            address VARCHAR(255) NULL,
            contact_phone VARCHAR(30) NULL,
            next_delivery DATE NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pharmacy_id) REFERENCES pharmacy(id) ON DELETE CASCADE
        )
    `);

    const [pharmacies] = await bootstrapConn.query('SELECT id FROM pharmacy LIMIT 1');
    if (pharmacies.length === 0) {
        const defaultPasswordHash = await bcrypt.hash('pass1234', 10);

        const [p1] = await bootstrapConn.query(
            'INSERT INTO pharmacy (name, address, city, phone) VALUES (?, ?, ?, ?)',
            ['CityCare Pharmacy', '12 Health Street', 'Mumbai', '+91-9000000001']
        );
        const [p2] = await bootstrapConn.query(
            'INSERT INTO pharmacy (name, address, city, phone) VALUES (?, ?, ?, ?)',
            ['Wellness Central', '55 Green Avenue', 'Pune', '+91-9000000002']
        );

        const cityCareId = p1.insertId;
        const wellnessId = p2.insertId;

        const [u1] = await bootstrapConn.query(
            'INSERT INTO users (pharmacy_id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [cityCareId, 'Ravi Owner', 'ravi@citycare.com', defaultPasswordHash, 'owner']
        );
        const [u2] = await bootstrapConn.query(
            'INSERT INTO users (pharmacy_id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [cityCareId, 'Anita Pharmacist', 'anita@citycare.com', defaultPasswordHash, 'staff']
        );
        const [u3] = await bootstrapConn.query(
            'INSERT INTO users (pharmacy_id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [wellnessId, 'Karan Owner', 'karan@wellness.com', defaultPasswordHash, 'owner']
        );
        await bootstrapConn.query(
            'INSERT INTO users (pharmacy_id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [wellnessId, 'Meera Staff', 'meera@wellness.com', defaultPasswordHash, 'staff']
        );

        const [m1] = await bootstrapConn.query('INSERT INTO medicine (pharmacy_id, name, category) VALUES (?, ?, ?)', [cityCareId, 'Paracetamol 500mg', 'Pain Relief']);
        const [m2] = await bootstrapConn.query('INSERT INTO medicine (pharmacy_id, name, category) VALUES (?, ?, ?)', [cityCareId, 'Azithromycin 250mg', 'Antibiotic']);
        const [m3] = await bootstrapConn.query('INSERT INTO medicine (pharmacy_id, name, category) VALUES (?, ?, ?)', [cityCareId, 'Cetirizine', 'Allergy']);
        const [m4] = await bootstrapConn.query('INSERT INTO medicine (pharmacy_id, name, category) VALUES (?, ?, ?)', [wellnessId, 'Ibuprofen 400mg', 'Pain Relief']);

        const [s1] = await bootstrapConn.query(
            'INSERT INTO stock (pharmacy_id, medicine_id, batch_number, quantity, expiry_date, price_per_unit, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [cityCareId, m1.insertId, 'PCM-101', 120, '2027-02-15', 2.5, u1.insertId]
        );
        const [s2] = await bootstrapConn.query(
            'INSERT INTO stock (pharmacy_id, medicine_id, batch_number, quantity, expiry_date, price_per_unit, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [cityCareId, m2.insertId, 'AZM-302', 40, '2026-06-10', 12.8, u2.insertId]
        );
        const [s3] = await bootstrapConn.query(
            'INSERT INTO stock (pharmacy_id, medicine_id, batch_number, quantity, expiry_date, price_per_unit, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [cityCareId, m3.insertId, 'CTZ-209', 14, '2026-05-12', 3.4, u2.insertId]
        );
        await bootstrapConn.query(
            'INSERT INTO stock (pharmacy_id, medicine_id, batch_number, quantity, expiry_date, price_per_unit, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [wellnessId, m4.insertId, 'IBU-411', 75, '2027-01-20', 4.75, u3.insertId]
        );

        await bootstrapConn.query(
            'INSERT INTO sale (pharmacy_id, stock_id, medicine_id, sold_by, quantity_sold, sale_price, sale_date) VALUES (?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 3 DAY)), (?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 1 DAY))',
            [cityCareId, s1.insertId, m1.insertId, u2.insertId, 18, 45.0, cityCareId, s2.insertId, m2.insertId, u1.insertId, 6, 76.8]
        );

        await bootstrapConn.query(
            'INSERT INTO expiry_alert (pharmacy_id, stock_id, message, severity) VALUES (?, ?, ?, ?)',
            [cityCareId, s2.insertId, 'Azithromycin batch AZM-302 expires soon', 'danger']
        );
        await bootstrapConn.query(
            'INSERT INTO stock_alert (pharmacy_id, stock_id, message, severity) VALUES (?, ?, ?, ?)',
            [cityCareId, s3.insertId, 'Cetirizine stock is low (14 units left)', 'warning']
        );

        await bootstrapConn.query(
            'INSERT INTO suppliers (pharmacy_id, name, address, contact_phone, next_delivery) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
            [
                cityCareId, 'PharmaCorp Global', '1200 Healthway Drive, NYC', '(800) 555-0199', '2026-10-26',
                cityCareId, 'Medisupply Co.', '88 Medical Plaza, Chicago', '(888) 123-4567', '2026-10-24',
                cityCareId, 'HealthLink Direct', 'Local Warehouse, NJ', '(201) 555-8833', '2026-10-18'
            ]
        );
    }

    await bootstrapConn.end();

    pool = mysql.createPool({
        ...dbConfig,
        database: dbName
    });
}

function getPool() {
    if (!pool) {
        throw new Error('Database not initialized. Call initDatabase() before using the pool.');
    }
    return pool;
}

module.exports = {
    initDatabase,
    query: (...args) => getPool().query(...args),
    getConnection: () => getPool().getConnection()
};
