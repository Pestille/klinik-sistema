// api/pacientes.js — Listar pacientes do banco Turso
// USO: GET /api/pacientes?busca=nome&page=1&limit=20

const { getClient } = require('./db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const client = getClient();
        const busca = req.query?.busca || '';
        const page = parseInt(req.query?.page) || 1;
        const limit = Math.min(parseInt(req.query?.limit) || 20, 100);
        const offset = (page - 1) * limit;

        let rows, totalResult;

        if (busca) {
            // Busca por nome, CPF ou telefone
            const searchTerm = `%${busca}%`;
            totalResult = await client.execute({
                sql: 'SELECT COUNT(*) as total FROM pacientes WHERE nome LIKE ? OR cpf LIKE ? OR telefone LIKE ?',
                args: [searchTerm, searchTerm, searchTerm]
            });
            const result = await client.execute({
                sql: 'SELECT * FROM pacientes WHERE nome LIKE ? OR cpf LIKE ? OR telefone LIKE ? ORDER BY nome LIMIT ? OFFSET ?',
                args: [searchTerm, searchTerm, searchTerm, limit, offset]
            });
            rows = result.rows;
        } else {
            totalResult = await client.execute('SELECT COUNT(*) as total FROM pacientes');
            const result = await client.execute({
                sql: 'SELECT * FROM pacientes ORDER BY nome LIMIT ? OFFSET ?',
                args: [limit, offset]
            });
            rows = result.rows;
        }

        const total = totalResult.rows[0].total;
        const totalPages = Math.ceil(total / limit);

        return res.status(200).json({
            success: true,
            data: rows,
            paginacao: {
                page,
                limit,
                total,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
