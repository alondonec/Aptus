const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { initialPatients, initialProtocols } = require('./seedData');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'aptus.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    name TEXT,
    identification TEXT,
    edad INTEGER,
    fechaNacimiento TEXT,
    phone TEXT,
    address TEXT,
    imc REAL,
    hta INTEGER,
    dm2 INTEGER,
    erc INTEGER,
    icc INTEGER,
    fa INTEGER,
    uacr REAL,
    fevi REAL,
    eventoCV INTEGER,
    dementia INTEGER,
    diagnostics TEXT,
    fechaIngreso TEXT,
    source TEXT
  );

  CREATE TABLE IF NOT EXISTS protocols (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    inclusionCriteria TEXT NOT NULL DEFAULT '[]',
    exclusionCriteria TEXT NOT NULL DEFAULT '[]'
  );
`);

// ---- Migración ligera: si la base ya existía de una versión anterior sin
// las columnas "edad"/"source", se agregan ahora (SQLite soporta ADD COLUMN
// sobre tablas existentes sin perder datos).
const existingColumns = new Set(db.prepare('PRAGMA table_info(patients)').all().map((c) => c.name));
if (!existingColumns.has('edad')) {
  db.exec('ALTER TABLE patients ADD COLUMN edad INTEGER;');
}
if (!existingColumns.has('source')) {
  db.exec('ALTER TABLE patients ADD COLUMN source TEXT;');
}
if (!existingColumns.has('fechaNacimiento')) {
  db.exec('ALTER TABLE patients ADD COLUMN fechaNacimiento TEXT;');
}

// ---- Conversión entre el modelo JS (booleanos true/false/null) y las
// columnas SQLite (que no tienen tipo boolean nativo, solo INTEGER 0/1/NULL).

function toDbBool(v) {
  if (v === null || v === undefined) return null;
  return v ? 1 : 0;
}

function fromDbBool(v) {
  if (v === null || v === undefined) return null;
  return v === 1;
}

function normalizeIdentification(v) {
  return String(v ?? '').replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

function rowToPatient(row) {
  return {
    id: row.id,
    name: row.name,
    identification: row.identification,
    edad: row.edad,
    fechaNacimiento: row.fechaNacimiento,
    phone: row.phone,
    address: row.address,
    imc: row.imc,
    hta: fromDbBool(row.hta),
    dm2: fromDbBool(row.dm2),
    erc: fromDbBool(row.erc),
    icc: fromDbBool(row.icc),
    fa: fromDbBool(row.fa),
    uacr: row.uacr,
    fevi: row.fevi,
    eventoCV: fromDbBool(row.eventoCV),
    dementia: fromDbBool(row.dementia),
    diagnostics: row.diagnostics,
    fechaIngreso: row.fechaIngreso,
    source: row.source,
  };
}

function rowToProtocol(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inclusionCriteria: JSON.parse(row.inclusionCriteria || '[]'),
    exclusionCriteria: JSON.parse(row.exclusionCriteria || '[]'),
  };
}

// ---- Pacientes

const stmts = {
  allPatients: db.prepare('SELECT * FROM patients ORDER BY rowid ASC'),
  getPatient: db.prepare('SELECT * FROM patients WHERE id = ?'),
  insertPatient: db.prepare(`
    INSERT INTO patients (id, name, identification, edad, fechaNacimiento, phone, address, imc, hta, dm2, erc, icc, fa, uacr, fevi, eventoCV, dementia, diagnostics, fechaIngreso, source)
    VALUES (@id, @name, @identification, @edad, @fechaNacimiento, @phone, @address, @imc, @hta, @dm2, @erc, @icc, @fa, @uacr, @fevi, @eventoCV, @dementia, @diagnostics, @fechaIngreso, @source)
  `),
  updatePatient: db.prepare(`
    UPDATE patients SET name=@name, identification=@identification, edad=@edad,
      fechaNacimiento=@fechaNacimiento, phone=@phone, address=@address, imc=@imc,
      hta=@hta, dm2=@dm2, erc=@erc, icc=@icc, fa=@fa, uacr=@uacr, fevi=@fevi,
      eventoCV=@eventoCV, dementia=@dementia, diagnostics=@diagnostics,
      fechaIngreso=@fechaIngreso, source=@source
    WHERE id=@id
  `),
  deletePatient: db.prepare('DELETE FROM patients WHERE id = ?'),
  deleteAllPatients: db.prepare('DELETE FROM patients'),
  countPatients: db.prepare('SELECT COUNT(*) AS n FROM patients'),

  allProtocols: db.prepare('SELECT * FROM protocols ORDER BY rowid ASC'),
  getProtocol: db.prepare('SELECT * FROM protocols WHERE id = ?'),
  insertProtocol: db.prepare(`
    INSERT INTO protocols (id, name, description, inclusionCriteria, exclusionCriteria)
    VALUES (@id, @name, @description, @inclusionCriteria, @exclusionCriteria)
  `),
  updateProtocol: db.prepare(`
    UPDATE protocols SET name = @name, description = @description,
      inclusionCriteria = @inclusionCriteria, exclusionCriteria = @exclusionCriteria
    WHERE id = @id
  `),
  deleteProtocol: db.prepare('DELETE FROM protocols WHERE id = ?'),
  deleteAllProtocols: db.prepare('DELETE FROM protocols'),
  countProtocols: db.prepare('SELECT COUNT(*) AS n FROM protocols'),
};

function getAllPatients() {
  return stmts.allPatients.all().map(rowToPatient);
}

function patientToParams(id, patient) {
  return {
    id,
    name: patient.name ?? null,
    identification: patient.identification ?? null,
    edad: patient.edad ?? null,
    fechaNacimiento: patient.fechaNacimiento ?? null,
    phone: patient.phone ?? null,
    address: patient.address ?? null,
    imc: patient.imc ?? null,
    hta: toDbBool(patient.hta),
    dm2: toDbBool(patient.dm2),
    erc: toDbBool(patient.erc),
    icc: toDbBool(patient.icc),
    fa: toDbBool(patient.fa),
    uacr: patient.uacr ?? null,
    fevi: patient.fevi ?? null,
    eventoCV: toDbBool(patient.eventoCV),
    dementia: toDbBool(patient.dementia),
    diagnostics: patient.diagnostics ?? null,
    fechaIngreso: patient.fechaIngreso ?? null,
    source: patient.source ?? null,
  };
}

function insertPatient(patient) {
  const id = patient.id || crypto.randomUUID();
  stmts.insertPatient.run(patientToParams(id, patient));
  return rowToPatient(stmts.getPatient.get(id));
}

function updatePatient(id, patient) {
  const existing = stmts.getPatient.get(id);
  if (!existing) return null;
  stmts.updatePatient.run(patientToParams(id, patient));
  return rowToPatient(stmts.getPatient.get(id));
}

function findPatientByIdentification(identification) {
  const target = normalizeIdentification(identification);
  if (!target) return null;
  const match = getAllPatients().find((p) => normalizeIdentification(p.identification) === target);
  return match || null;
}

function deletePatient(id) {
  const result = stmts.deletePatient.run(id);
  return result.changes > 0;
}

function deleteAllPatients() {
  const result = stmts.deleteAllPatients.run();
  return result.changes;
}

function replaceAllPatients(patients) {
  db.exec('BEGIN');
  try {
    stmts.deleteAllPatients.run();
    for (const p of patients) {
      insertPatient(p);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getAllPatients();
}

// ---- Protocolos

function getAllProtocols() {
  return stmts.allProtocols.all().map(rowToProtocol);
}

function insertProtocol(protocol) {
  const id = protocol.id || crypto.randomUUID();
  stmts.insertProtocol.run({
    id,
    name: protocol.name,
    description: protocol.description ?? null,
    inclusionCriteria: JSON.stringify(protocol.inclusionCriteria ?? []),
    exclusionCriteria: JSON.stringify(protocol.exclusionCriteria ?? []),
  });
  return rowToProtocol(stmts.getProtocol.get(id));
}

function updateProtocol(id, protocol) {
  const existing = stmts.getProtocol.get(id);
  if (!existing) return null;
  stmts.updateProtocol.run({
    id,
    name: protocol.name,
    description: protocol.description ?? null,
    inclusionCriteria: JSON.stringify(protocol.inclusionCriteria ?? []),
    exclusionCriteria: JSON.stringify(protocol.exclusionCriteria ?? []),
  });
  return rowToProtocol(stmts.getProtocol.get(id));
}

function deleteProtocol(id) {
  const result = stmts.deleteProtocol.run(id);
  return result.changes > 0;
}

function replaceAllProtocols(protocols) {
  db.exec('BEGIN');
  try {
    stmts.deleteAllProtocols.run();
    for (const p of protocols) {
      insertProtocol(p);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getAllProtocols();
}

// ---- Semilla inicial: solo si las tablas están vacías (primer arranque).

function seedIfEmpty() {
  if (stmts.countPatients.get().n === 0) {
    for (const p of initialPatients) insertPatient(p);
  }
  if (stmts.countProtocols.get().n === 0) {
    for (const p of initialProtocols) insertProtocol(p);
  }
}

seedIfEmpty();

module.exports = {
  getAllPatients,
  insertPatient,
  updatePatient,
  findPatientByIdentification,
  deletePatient,
  deleteAllPatients,
  replaceAllPatients,
  getAllProtocols,
  insertProtocol,
  updateProtocol,
  deleteProtocol,
  replaceAllProtocols,
};
