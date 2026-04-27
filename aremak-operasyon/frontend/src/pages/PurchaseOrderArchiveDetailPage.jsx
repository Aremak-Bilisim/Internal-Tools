import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Typography, Space, Spin, message, Table } from 'antd'
import { ArrowLeftOutlined, FilePdfOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'

const { Title, Text } = Typography

export default function PurchaseOrderArchiveDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [po, setPo] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    api.get(`/purchase-orders/archive/${id}`)
      .then((r) => setPo(r.data))
      .catch((e) => message.error(e?.response?.data?.detail || 'Arşiv yüklenemedi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
  if (!po) return <div>Arşiv bulunamadı</div>

  const grandTotal = po.items.reduce((s, it) => s + (Number(it.line_total) || 0), 0)
  const totalQty = po.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)

  const itemColumns = [
    { title: '#', key: 'idx', width: 40, render: (_, __, i) => i + 1 },
    {
      title: 'Ürün', key: 'product',
      render: (_, it) => (
        <div>
          <div style={{ fontWeight: 500 }}>{it.product_name}</div>
          {it.matched_displayname && (
            <div style={{ fontSize: 11, color: '#52c41a' }}>
              ✓ Eşleşme: {it.matched_displayname} {it.matched_sku && `(${it.matched_sku})`}
            </div>
          )}
          {!it.product_id && (
            <div style={{ fontSize: 11, color: '#faad14' }}>⚠ Lokal ürünle eşleşmedi</div>
          )}
        </div>
      ),
    },
    {
      title: 'Adet', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'right',
      render: (v) => v != null ? Number(v).toLocaleString('tr-TR') : '-',
    },
    {
      title: 'Tutar', dataIndex: 'line_total', key: 'line_total', width: 140, align: 'right',
      render: (v, r) => v != null
        ? <Text strong>{`${Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${r.currency || ''}`}</Text>
        : '-',
    },
  ]

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/purchase-orders')} style={{ marginBottom: 16 }}>
        Geri
      </Button>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

          <Card
            title={
              <Space>
                <span>{po.siparis_no || `Arşiv #${po.archive_id}`}</span>
                <Tag color="blue">ARŞİV</Tag>
                <Tag color={po.is_received ? 'green' : 'orange'}>
                  {po.is_received ? 'Teslim Alındı' : 'Bekleniyor'}
                </Tag>
              </Space>
            }
            extra={
              <Space>
                {(po.pdf_url || po.local_pdf_url || po.knack_pdf_url) && (
                  <Button
                    size="small"
                    icon={<FilePdfOutlined />}
                    href={po.pdf_url || po.local_pdf_url || po.knack_pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#ff4d4f', borderColor: '#ff4d4f' }}
                  >
                    Proforma PDF
                  </Button>
                )}
                {po.tg_url && (
                  <Button size="small" icon={<ExportOutlined />} href={po.tg_url} target="_blank" rel="noreferrer">
                    TG Tedarikçi
                  </Button>
                )}
                <Button size="small" icon={<ReloadOutlined />} onClick={load}>Yenile</Button>
              </Space>
            }
          >
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Sipariş No">{po.siparis_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="Tedarikçi">{po.supplier?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Sipariş Tarihi">{po.order_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="Teslim Tarihi">
                {po.delivery_date
                  ? <span style={{ color: '#52c41a' }}>{po.delivery_date}</span>
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Para Birimi">{po.currency || '-'}</Descriptions.Item>
              <Descriptions.Item label="Toplam (Knack)">
                <Text strong>
                  {po.total != null
                    ? `${Number(po.total).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${po.currency || ''}`
                    : '-'}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="İmport Tarihi">
                {po.imported_at ? po.imported_at.slice(0, 10) : '-'}
              </Descriptions.Item>
              {po.knack_record_id && (
                <Descriptions.Item label="Knack Kayıt ID" span={2}>
                  <Text code style={{ fontSize: 11 }}>{po.knack_record_id}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>

          <Card title={`Ürünler (${po.items.length})`} size="small">
            <Table
              dataSource={po.items}
              columns={itemColumns}
              rowKey={(_, i) => i}
              pagination={false}
              size="small"
              summary={() => (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: '#fafafa' }}>
                    <Table.Summary.Cell index={0} colSpan={2}><Text strong>TOPLAM</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Text strong>{totalQty.toLocaleString('tr-TR')}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <Text strong>
                        {grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {po.currency || ''}
                      </Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          </Card>

        </div>
      </div>
    </div>
  )
}
