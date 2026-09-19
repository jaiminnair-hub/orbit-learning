import { ObjectEditor } from "./object-editor";

export default async function LearningObjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ObjectEditor objectId={id} />;
}
