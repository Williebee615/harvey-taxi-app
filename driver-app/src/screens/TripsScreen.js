import React from 'react';

import { Card, H, money, Row } from '../ui';
import PagedList from './PagedList';

export default function TripsScreen({ app }) {
  return (
    <PagedList
      load={app.actions.loadTrips}
      itemsKey="trips"
      empty="No completed trips yet."
      header={() => (
        <Card>
          <H>Trip history</H>
        </Card>
      )}
      renderItem={({ item }) => (
        <Card>
          <Row label="Completed" value={item.completed_at ? new Date(item.completed_at).toLocaleString() : '—'} />
          <Row label="From" value={item.pickup_address || '—'} />
          <Row label="To" value={item.dropoff_address || '—'} />
          <Row label="Fare" value={money(item.final_fare ?? item.estimated_fare)} />
          {item.is_review_ride && <Row label="Test ride" value="Simulated" />}
        </Card>
      )}
    />
  );
}
