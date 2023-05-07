import { NodeViewWrapper } from "@tiptap/react";
import React from "react";
import styled from "styled-components";
import "katex/dist/katex.min.css";
import { InlineMath, BlockMath } from "react-katex";
import { Edit, Save } from "lucide-react";
import Link from "next/link";

function MathEquationBlockComponent(props: any) {
  const [equation, setEquation] = React.useState(props.node.attrs.math_equation);
  const [isEditing, setIsEditing] = React.useState(true);
  const isEditable = props.extension.options.editable;

  const handleEquationChange = (event: React.ChangeEvent<any>) => {
    setEquation(event.target.value);
    props.updateAttributes({
      math_equation: equation,
    });
  };

  const saveEquation = () => {
    props.updateAttributes({
      math_equation: equation,
    });
    setIsEditing(false);
  };

  return (
    <NodeViewWrapper className="block-math-equation">
      <MathEqWrapper>
        {isEditable && (
          <MathEqTopMenu>
            <button onClick={() => setIsEditing(true)}>
              <Edit size={15}></Edit>
            </button>
            <span className="pl-2">Edit</span>
          </MathEqTopMenu>
        )}
        <BlockMath>{equation}</BlockMath>
        {isEditing && (
          <>
            <EditBar>
              <input value={equation} onChange={handleEquationChange} placeholder="Insert a Math Equation (LaTeX) " type="text" />
              <button onClick={() => saveEquation()}>
                <Save size={15}></Save>
              </button>
            </EditBar>
            <span className="pt-2 text-zinc-500 text-sm">Please refer to this <Link className="text-zinc-900 after:content-['↗']" href="https://katex.org/docs/supported.html" target="_blank"> guide</Link> for supported TeX functions </span>
          </>

        )}
      </MathEqWrapper>
    </NodeViewWrapper>
  );
}

export default MathEquationBlockComponent;

const MathEqWrapper = styled.div`
  display: flex;
  flex-direction: column;
  background: #f9f9f9a2;
  border-radius: 8px;
  margin: 20px;
  padding: 20px;
  min-height: 74px;
  border: ${(props) => (props.contentEditable ? "2px dashed #713f1117" : "none")};
`;

const MathEqTopMenu = styled.div`
  display: flex;
  justify-content: flex-start;
  button {
    margin-left: 10px;
    cursor: pointer;
    border: none;
    background: none;
    font-size: 14px;
    color: #494949;
  }
`;

const EditBar = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
  background-color: white;
  border-radius: 10px;
  padding: 5px;
  color: #5252528d;
  align-items: center;
  justify-content: space-between;
  height: 50px;
  border: solid 1px #52525224;

  button {
    margin-left: 10px;
    margin-right: 7px;
    cursor: pointer;
    border: none;
    background: none;
    font-size: 14px;
    color: #494949;
  }

  input {
    border: none;
    background: none;
    font-size: 14px;
    color: #494949;
    width: 100%;
    font-family: "DM Sans", sans-serif;
    padding-left: 10px;
    &:focus {
      outline: none;
    }

    &::placeholder {
      color: #49494936;
    }
  }
`;
