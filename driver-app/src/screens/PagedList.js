import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import { C, Notice, P } from '../ui';

// Keyset-paged list: loads 20 at a time, more on scroll, pull to refresh.
export default function PagedList({ load, itemsKey, renderItem, header, empty }) {
  const [items, setItems] = useState([]);
  const [extra, setExtra] = useState(null);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const fetchPage = useCallback(
    async (before) => {
      setLoading(true);
      setError(null);
      try {
        const res = await load(before);
        const page = res[itemsKey] || [];
        setItems((prev) => (before ? [...prev, ...page] : page));
        if (!before) setExtra(res);
        setNext(res.next_before || null);
        setDone(!res.next_before);
      } catch (err) {
        setError(err.message || 'Could not load.');
      } finally {
        setLoading(false);
      }
    },
    [load, itemsKey]
  );

  useEffect(() => {
    fetchPage(null);
  }, [fetchPage]);

  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      data={items}
      keyExtractor={(item, i) => String(item.id || i)}
      renderItem={renderItem}
      ListHeaderComponent={
        <View>
          {header ? header(extra) : null}
          <Notice text={error} onClose={() => setError(null)} />
        </View>
      }
      ListEmptyComponent={!loading && !error ? <P muted>{empty}</P> : null}
      ListFooterComponent={loading ? <ActivityIndicator color={C.cyan} style={{ margin: 16 }} /> : null}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (!loading && !done && next) fetchPage(next);
      }}
      refreshControl={<RefreshControl tintColor={C.cyan} refreshing={false} onRefresh={() => fetchPage(null)} />}
    />
  );
}
