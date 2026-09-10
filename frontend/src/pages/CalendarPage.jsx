import CalendarView from "../components/CalendarView.jsx";
import { Page, PageHeader } from "../components/layout/Page.jsx";

export default function CalendarPage() {
  return (
    <Page>
      <PageHeader
        title="Calendar"
        subtitle="What actually happened, and what your recurring items predict next"
      />
      <CalendarView />
    </Page>
  );
}
