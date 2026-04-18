import React, { useEffect, useState } from 'react'
import { Table, Input, Card, Tag, Typography, Spin } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import api from '../services/api'

const { Title } = Typography

export default function ProductsPage() {
  const [data, setData] = useState({ Products: [], count: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const pagesize = 50

  useEffect(() => {
    setLoading(true)
    api.get(`/products?page=${page}&pagesize=${pagesize}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }, [page])

  const filtered = search
    ? data.Products.filter(
        (p) =>
          p.DisplayName?.toLowerCase().includes(search.toLowerCase()) ||
          p.Sku?.toLowerCase().includes(search.toLowerCase())
      )
    : data.Products

  const columns = [
    { title: 'Marka / Model', dataIndex: 'DisplayName', key: 'DisplayName', width: 260 },
    { title: 'SKU', dataIndex: 'Sku', key: 'Sku', width: 160 },
    {
      title: 'Stok',
      dataIndex: 'Inventory',
      key: 'Inventory',
      width: 80,
      render: (v) => (
        <Tag color={v > 0 ? 'green' : 'red'}>{v ?? 0}</Tag>
      ),
    },
    {
      title: 'Satış Fiyatı',
      key: 'price',
      width: 140,
      render: (_, r) => r.Price ? `${r.Price} ${r.CurrencyName}` : '-',
    },
    {
      title: 'Alış Fiyatı',
      key: 'purchase',
      width: 140,
      render: (_, r) => r.PurchasePrice ? `${r.PurchasePrice} ${r.PurchaseCurrencyName}` : '-',
    },
    { title: 'Kategori', dataIndex: ['Category', 'Name'], key: 'category', width: 140, render: (v) => v || '-' },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>Stoktaki Ürünler</Title>
      <Card>
        <Input
          prefix={<SearchOutlined />}
          placeholder="Model adı veya SKU ile ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320, marginBottom: 16 }}
          allowClear
        />
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="Id"
          loading={loading}
          pagination={{
            current: page,
            pageSize: pagesize,
            total: data.count,
            onChange: (p) => setPage(p),
            showTotal: (t) => `Toplam ${t} ürün`,
          }}
          scroll={{ x: 900 }}
          size="middle"
        />
      </Card>
    </div>
  )
}
