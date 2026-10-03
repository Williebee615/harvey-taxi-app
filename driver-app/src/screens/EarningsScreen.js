import React from 'react';
import { View } from 'react-native';

import { Card, H, money, P, Row } from '../ui';
import PagedList from './PagedList';

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

export default function EarningsScreen({ app }) {
  return (
    <PagedList
      load={app.actions.loadEarnings}
      itemsKey="records"
      empty="No earnings yet. Completed trips appear here."
      header={(res) => (
        <View>
          <Card>
            <H>Earnings</H>
            {res && res.review_mode && <P muted>Test account: amounts are simulated.</P>}
            <Row label="Last 24 hours" value={money(res?.totals?.last_24_hours)} />
            <Row label="Last 7 days" value={money(res?.totals?.last_7_days)} />
            <Row label="All time" value={money(res?.totals?.all_time)} />
            <P muted style={{ marginTop: 8 }}>Payouts are made by Harvey Taxi; amounts here are what your completed trips earned.</P>
          </Card>
        </View>
      )}
      renderItem={({ item }) => (
        <Card>
          <Row label={when(item.created_at)} value={money(item.total_earning)} />
          {item.tip_amount > 0 && <Row label="Includes tip" value={money(item.tip_amount)} />}
          {item.status && <Row label="Status" value={item.status} />}
        </Card>
      )}
    />
  );
}
