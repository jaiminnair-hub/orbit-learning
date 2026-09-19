import { PathEditor } from "./path-editor";

export default async function LearningPathAdminPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PathEditor pathId={id} />;
}
