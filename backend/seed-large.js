const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

function fmtDate(date) {
    return date.toISOString().slice(0, 10);
}

async function main() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'yasql',
        database: 'mednifi',
        multipleStatements: true
    });

    await connection.query(`
        SET FOREIGN_KEY_CHECKS=0;
        TRUNCATE TABLE sale;
        TRUNCATE TABLE expiry_alert;
        TRUNCATE TABLE stock_alert;
        TRUNCATE TABLE stock;
        TRUNCATE TABLE medicine;
        TRUNCATE TABLE suppliers;
        TRUNCATE TABLE users;
        TRUNCATE TABLE pharmacy;
        SET FOREIGN_KEY_CHECKS=1;
    `);

    const [pharmacyRes] = await connection.query(
        'INSERT INTO pharmacy (name, address, city, phone) VALUES (?, ?, ?, ?)',
        ['Mednifi Demo Pharmacy', '101 Central Health Road', 'Mumbai', '+91-22-4000-7788']
    );
    const pharmacyId = pharmacyRes.insertId;

    const passwordHash = await bcrypt.hash('pass1234', 10);
    const users = [
        ['Ravi Owner', 'ravi@mednifi.com', 'owner'],
        ['Anita Pharmacist', 'anita@mednifi.com', 'staff'],
        ['Kunal Inventory', 'kunal@mednifi.com', 'staff'],
        ['Meera Sales', 'meera@mednifi.com', 'staff']
    ];

    const userIds = [];
    for (const [name, email, role] of users) {
        const [res] = await connection.query(
            'INSERT INTO users (pharmacy_id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [pharmacyId, name, email, passwordHash, role]
        );
        userIds.push(res.insertId);
    }

    const medicineCatalog = [
        ['Paracetamol 500mg', 'Pain Relief'],
        ['Ibuprofen 400mg', 'Pain Relief'],
        ['Diclofenac 50mg', 'Pain Relief'],
        ['Aceclofenac 100mg', 'Pain Relief'],
        ['Amoxicillin 500mg', 'Antibiotic'],
        ['Azithromycin 500mg', 'Antibiotic'],
        ['Cefixime 200mg', 'Antibiotic'],
        ['Ciprofloxacin 500mg', 'Antibiotic'],
        ['Metformin 500mg', 'Diabetes'],
        ['Metformin 1000mg', 'Diabetes'],
        ['Glimepiride 1mg', 'Diabetes'],
        ['Glimepiride 2mg', 'Diabetes'],
        ['Sitagliptin 50mg', 'Diabetes'],
        ['Sitagliptin 100mg', 'Diabetes'],
        ['Telmisartan 40mg', 'Cardiac'],
        ['Telmisartan 80mg', 'Cardiac'],
        ['Amlodipine 5mg', 'Cardiac'],
        ['Amlodipine 10mg', 'Cardiac'],
        ['Atorvastatin 10mg', 'Cardiac'],
        ['Atorvastatin 20mg', 'Cardiac'],
        ['Rosuvastatin 10mg', 'Cardiac'],
        ['Aspirin 75mg', 'Cardiac'],
        ['Clopidogrel 75mg', 'Cardiac'],
        ['Pantoprazole 40mg', 'Gastro'],
        ['Omeprazole 20mg', 'Gastro'],
        ['Rabeprazole 20mg', 'Gastro'],
        ['Domperidone 10mg', 'Gastro'],
        ['Ondansetron 4mg', 'Gastro'],
        ['Levocetirizine 5mg', 'Allergy'],
        ['Cetirizine 10mg', 'Allergy'],
        ['Fexofenadine 120mg', 'Allergy'],
        ['Montelukast 10mg', 'Allergy'],
        ['Vitamin C 500mg', 'Vitamin'],
        ['Vitamin D3 60000 IU', 'Vitamin'],
        ['Vitamin B12 1500mcg', 'Vitamin'],
        ['Calcium + D3', 'Vitamin'],
        ['Iron Folic Acid', 'Vitamin'],
        ['Zinc 50mg', 'Vitamin'],
        ['Multivitamin Daily', 'Vitamin'],
        ['Clotrimazole Cream', 'Dermatology'],
        ['Mupirocin Ointment', 'Dermatology'],
        ['Hydrocortisone Cream', 'Dermatology'],
        ['Luliconazole Cream', 'Dermatology'],
        ['Salicylic Acid Ointment', 'Dermatology'],
        ['Losartan 50mg', 'Cardiac'],
        ['Nebivolol 5mg', 'Cardiac'],
        ['Metoprolol 25mg', 'Cardiac'],
        ['Gliclazide MR 30mg', 'Diabetes'],
        ['Empagliflozin 10mg', 'Diabetes'],
        ['Empagliflozin 25mg', 'Diabetes'],
        ['Amoxicillin Clavulanate 625mg', 'Antibiotic'],
        ['Doxycycline 100mg', 'Antibiotic'],
        ['Levofloxacin 500mg', 'Antibiotic'],
        ['ORS Sachet', 'Gastro'],
        ['Probiotic Capsule', 'Gastro'],
        ['Antacid Suspension', 'Gastro'],
        ['Albendazole 400mg', 'General'],
        ['Ranitidine 150mg', 'Gastro']
    ];

    const medicineIds = [];
    for (const [name, category] of medicineCatalog) {
        const [res] = await connection.query(
            'INSERT INTO medicine (pharmacy_id, name, category) VALUES (?, ?, ?)',
            [pharmacyId, name, category]
        );
        medicineIds.push(res.insertId);
    }

    const today = new Date();
    const stockRows = [];
    for (let i = 0; i < medicineIds.length; i += 1) {
        const medicineId = medicineIds[i];
        const batch = `B-${String(i + 1).padStart(4, '0')}`;
        const quantity = 22 + ((i * 9) % 145);
        const price = (8 + ((i * 17) % 280) / 10).toFixed(2);

        // Keep expiries staggered naturally: most are healthy, some near-expiry, few urgent.
        let expiryOffset = 55 + ((i * 11) % 240);
        if (i < 5) expiryOffset = 3 + (i * 2);       // 5 urgent rows
        else if (i < 11) expiryOffset = 10 + (i * 2); // 6 near-expiry rows

        const adjustedQuantity = i % 13 === 0 ? 8 + (i % 7) : quantity;
        const expiryDate = new Date(today);
        expiryDate.setDate(today.getDate() + expiryOffset);
        const createdBy = userIds[i % userIds.length];

        const [res] = await connection.query(
            'INSERT INTO stock (pharmacy_id, medicine_id, batch_number, quantity, expiry_date, price_per_unit, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [pharmacyId, medicineId, batch, adjustedQuantity, fmtDate(expiryDate), price, createdBy]
        );

        stockRows.push({
            id: res.insertId,
            medicineId,
            quantity: adjustedQuantity,
            price: Number(price),
            batchNumber: batch
        });
    }

    for (let d = 0; d < 30; d += 1) {
        const day = new Date(today);
        day.setDate(today.getDate() - d);
        const salesPerDay = 8 + (d % 6);

        for (let j = 0; j < salesPerDay; j += 1) {
            const idx = (d * 17 + j * 11) % stockRows.length;
            const stock = stockRows[idx];
            const qty = 1 + ((d + j) % 6);
            const soldBy = userIds[(d + j) % userIds.length];
            const salePrice = Number((stock.price * qty).toFixed(2));

            await connection.query(
                'INSERT INTO sale (pharmacy_id, stock_id, medicine_id, sold_by, quantity_sold, sale_price, sale_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [pharmacyId, stock.id, stock.medicineId, soldBy, qty, salePrice, day.toISOString().slice(0, 19).replace('T', ' ')]
            );
        }
    }

    const [expiringRows] = await connection.query(
        `SELECT s.id, m.name, s.batch_number, s.expiry_date
         FROM stock s
         INNER JOIN medicine m ON m.id = s.medicine_id
         WHERE s.pharmacy_id = ? AND s.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)`,
        [pharmacyId]
    );

    for (const row of expiringRows) {
        await connection.query(
            'INSERT INTO expiry_alert (pharmacy_id, stock_id, message, severity) VALUES (?, ?, ?, ?)',
            [pharmacyId, row.id, `${row.name} (Batch ${row.batch_number}) expires on ${fmtDate(new Date(row.expiry_date))}`, 'danger']
        );
    }

    const [lowRows] = await connection.query(
        `SELECT s.id, m.name, s.quantity
         FROM stock s
         INNER JOIN medicine m ON m.id = s.medicine_id
         WHERE s.pharmacy_id = ? AND s.quantity < 20`,
        [pharmacyId]
    );

    for (const row of lowRows) {
        await connection.query(
            'INSERT INTO stock_alert (pharmacy_id, stock_id, message, severity) VALUES (?, ?, ?, ?)',
            [pharmacyId, row.id, `${row.name} is low (${row.quantity} units left)`, 'warning']
        );
    }

    const suppliers = [
        ['PharmaCorp Global', '1200 Healthway Drive, NYC', '(800) 555-0199', '2026-10-26'],
        ['MediSupply Co.', '88 Medical Plaza, Chicago', '(888) 123-4567', '2026-10-24'],
        ['HealthLink Direct', 'Local Warehouse, NJ', '(201) 555-8833', '2026-10-18'],
        ['Zenith Lifecare', 'Pune Industrial Zone', '(020) 4000-1122', '2026-10-27'],
        ['Apollo Distributors', 'Andheri East, Mumbai', '(022) 4555-9031', '2026-10-23']
    ];

    for (const [name, address, phone, nextDelivery] of suppliers) {
        await connection.query(
            'INSERT INTO suppliers (pharmacy_id, name, address, contact_phone, next_delivery) VALUES (?, ?, ?, ?, ?)',
            [pharmacyId, name, address, phone, nextDelivery]
        );
    }

    const [counts] = await connection.query(`
        SELECT
            (SELECT COUNT(*) FROM pharmacy) AS pharmacy_count,
            (SELECT COUNT(*) FROM users) AS users_count,
            (SELECT COUNT(*) FROM medicine) AS medicine_count,
            (SELECT COUNT(*) FROM stock) AS stock_count,
            (SELECT COUNT(*) FROM sale) AS sale_count,
            (SELECT COUNT(*) FROM expiry_alert) AS expiry_alert_count,
            (SELECT COUNT(*) FROM stock_alert) AS stock_alert_count,
            (SELECT COUNT(*) FROM suppliers) AS suppliers_count
    `);

    console.log(JSON.stringify(counts[0], null, 2));
    await connection.end();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
