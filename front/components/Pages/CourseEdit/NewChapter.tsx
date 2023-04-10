import FormLayout, { Flex, FormField, Input, Textarea, FormLabel, ButtonBlack } from "@components/UI/Form/Form";
import { FormMessage } from "@radix-ui/react-form";
import * as Form from '@radix-ui/react-form';
import React, { useState } from "react";

function NewChapterModal({ submitChapter, closeModal }: any) {
  const [chapterName, setChapterName] = useState("");
  const [chapterDescription, setChapterDescription] = useState("");

  const handleChapterNameChange = (e: any) => {
    setChapterName(e.target.value);
  };

  const handleChapterDescriptionChange = (e: any) => {
    setChapterDescription(e.target.value);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    console.log({ chapterName, chapterDescription });
    submitChapter({ name: chapterName, description: chapterDescription, activities: [] });
  };

  return (

    <FormLayout onSubmit={handleSubmit}>
      <FormField name="chapter-name">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Chapter name</FormLabel>
          <FormMessage match="valueMissing">Please provide a chapter name</FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input onChange={handleChapterNameChange} type="text" required />
        </Form.Control>
      </FormField>
      <FormField name="chapter-desc">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Chapter description</FormLabel>
          <FormMessage match="valueMissing">Please provide a chapter description</FormMessage>
        </Flex>
        <Form.Control asChild>
          <Textarea onChange={handleChapterDescriptionChange} required />
        </Form.Control>
      </FormField>

      <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
        <Form.Submit asChild>
          <ButtonBlack type="submit" css={{ marginTop: 10 }}>Create chapter</ButtonBlack>
        </Form.Submit>
      </Flex>
    </FormLayout>
  );
}

export default NewChapterModal;
