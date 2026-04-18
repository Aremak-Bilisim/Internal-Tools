import React, { useEffect, useState } from 'react'
import { Table, Card, Tag, Typography, Button } from 'antd'
import { ExportOutlined } from '@ant-design/icons'
import api from '../services/api'

const { Title } = Typography

const STATUS_COLORS = { 0: 'blue', 1: 'green', 2: 'red' }
const STATUS_LABELS = { 0: 'Açık', 1: 'Tamamlandı', 2: 'İptal' }

export default function OrdersPage() {
  const [data, setData] = useState({ List: [], OrderCount: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pagesize = 50

  useEffect(() => {
    setLoading(true)
    api.get(`/orders?page=${page}&pagesize=${pagesize}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }, [page])

  const columns = [
    {
      title: 'Sipariş',
      dataIndex: 'Displayname',
      key: 'name',
      render: (v, r) => (
        <a href={`https://www.teamgram.com/aremak/order/${r.Id}`} target="_blank" rel="noreferrer">
          {v}
        </a>
      ),
    },
    {
      title: 'Müşteri',
      key: 'customer',
      render: (_, r) => r.RelatedEntity?.Displayname || r.RelatedEntity?.Name || '-',
      width: 220,
    },
    {
      title: 'Durum',
      dataIndex: 'Status',
      key: 'status',
      width: 110,
      render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag>,
    },
    {
      title: 'Aşama',
      dataIndex: 'CustomStageName',
      key: 'stage',
      width: 180,
      render: (v) => v || '-',
    },
    {
      title: 'Tutar',
      key: 'total',
      width: 140,
      render: (_, r) => r.DiscountedTotal ? `${Number(r.DiscountedTotal).toLocaleString('tr-TR')} ${r.CurrencyName}` : '-',
    },
    {
      title: 'Sipariş Tarihi',
      dataIndex: 'OrderDate',
      key: 'date',
      width: 120,
      render: (v) => v?.slice(0, 10),
    },
    {
      title: 'Fatura',
      dataIndex: 'HasInvoice',
      key: 'invoice',
      width: 80,
      render: (v) => v ? <Tag color="green">Var</Tag> : <Tag>Yok</Tag>,
    },
    {
      title: 'TeamGram',
      key: 'link',
      width: 90,
      render: (_, r) => (
        <a href={`https://www.teamgram.com/aremak/order/${r.Id}`} target="_blank" rel="noreferrer">
          <ExportOutlined />
        </a>
      ),
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>Müşteri Siparişleri</Title>
      <Card>
        <Table
          dataSource={data.List}
          columns={columns}
          rowKey="Id"
          loading={loading}
          pagination={{
            current: page,
            pageSize: pagesize,
            total: data.OrderCount || data.List?.length,
            onChange: (p) => setPage(p),
            showTotal: (t) => `Toplam ${t} sipariş`,
          }}
          scroll={{ x: 1000 }}
          size="middle"
        />
      </Card>
    </div>
  )
}
