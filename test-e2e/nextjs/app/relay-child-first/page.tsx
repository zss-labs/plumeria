import '@plumeria/core';
import { RelayOrderChild } from 'component/RelayOrderChild';
import { relay } from 'component/relay-order.styles';

export default function Page() {
  return (
    <RelayOrderChild override={relay.override}>child first</RelayOrderChild>
  );
}
